// ==UserScript==
// @name         Rie's Mod
// @namespace    https://github.com/lxyxny/Rie-s-Mod
// @version      1.0.1
// @description  Custom name/level/gradient + private level for mod users. Owners see real level.
// @author       khayrie
// @match        https://bonk.io/*
// @match        https://bonkisback.io/*
// @match        https://multiplayer.gg/physics/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const uw = unsafeWindow;
    if (!uw || typeof uw.playerids === 'undefined') return;

    // ===== CONFIG =====
    let CUSTOM_NAME = "★Custom★";
    let CUSTOM_LEVEL = "Level 999";
    let isNameActive = true;
    let currentGradient = null;
    const nicknames = {};
    const remoteCustomizations = {}; // { playerId: { name, level, gradient } }

    // Owner list (only these users see REAL levels)
    const OWNER_USERNAMES = new Set(["ki1la", "khayrie", "Il fait"]);

    // Predefined gradients
    const PRESETS = {
        fire: { colors: ["#ff4500", "#ff8c00", "#ffd700"], speed: 80 },
        ocean: { colors: ["#00bfff", "#1e90ff", "#4682b4"], speed: 100 },
        sunset: { colors: ["#ff4500", "#ffa500", "#ffd700", "#daa520"], speed: 120 },
        neon: { colors: ["#ff00ff", "#00ffff", "#ffff00"], speed: 60 },
        rainbow: { colors: ["red", "orange", "yellow", "green", "blue", "indigo", "violet"], speed: 90 }
    };

    // Wait for game iframe
    function waitForGame(callback) {
        const frame = document.getElementById('maingameframe');
        if (!frame || !frame.contentWindow || !frame.contentWindow.PIXI) {
            setTimeout(() => waitForGame(callback), 200);
            return;
        }
        if (typeof uw.playerids === 'undefined' || typeof uw.myid === 'undefined') {
            setTimeout(() => waitForGame(callback), 200);
            return;
        }
        callback(frame.contentWindow, frame.contentDocument);
    }

    // Generate flowing gradient CSS
    function createFlowingGradient(colors, progress) {
        const stops = colors.map((color, i) => {
            const pos = (i / (colors.length - 1)) * 100;
            return `${color} ${pos}%`;
        }).join(', ');
        return `linear-gradient(${progress}deg, ${stops})`;
    }

    // Apply animated gradient to DOM elements
    function applyGradientEffect(el, gradient) {
        if (el.dataset.gradientApplied) return;
        el.dataset.gradientApplied = 'true';
        let progress = 0;

        setInterval(() => {
            if (!el.isConnected) return;
            progress = (progress + 1) % 360;
            el.style.backgroundImage = createFlowingGradient(gradient.colors, progress);
            el.style.backgroundClip = "text";
            el.style.webkitBackgroundClip = "text";
        }, gradient.speed);
    }

    // Hook PIXI.Text to replace names at render time
    function hookPIXIText(gameWin) {
        if (!gameWin?.PIXI?.Text?.prototype) return;
        const originalUpdate = gameWin.PIXI.Text.prototype.updateText;
        gameWin.PIXI.Text.prototype.updateText = function() {
            if (typeof this.text !== 'string') return originalUpdate.call(this);

            for (const id in uw.playerids || {}) {
                const player = uw.playerids[id];
                if (!player || !player.userName) continue;

                let displayName = player.userName;
                if (nicknames[id]) {
                    displayName = nicknames[id];
                } else if (id == uw.myid && isNameActive) {
                    displayName = CUSTOM_NAME;
                }

                if (this.text.includes(player.userName) && displayName !== player.userName) {
                    this.text = this.text.replace(new RegExp(player.userName, 'g'), displayName);
                    this.style.fill = 0xFFD700; // Fallback gold for PIXI
                }
            }
            return originalUpdate.call(this);
        };
    }

    // Update all DOM locations safely
    function updateAllDOM(doc) {
        const targets = [
            { sel: '#pretty_top_name', type: 'name' },
            { sel: '.newbonklobby_playerentry_name', type: 'name' },
            { sel: '.ingamescoreboard_playername', type: 'name' },
            { sel: '.ingamechatname', type: 'name' },
            { sel: '.newbonklobby_chat_msg_name', type: 'name' },
            { sel: '#ingamewinner_top', type: 'name' },
            { sel: '.replay_playername', type: 'name' },
            { sel: '#pretty_top_level', type: 'level' },
            { sel: '.newbonklobby_playerentry_level', type: 'level' }
        ];

        targets.forEach(t => {
            doc.querySelectorAll(t.sel).forEach(el => {
                if (el.dataset.customProcessed) return;
                el.dataset.customProcessed = 'true';

                for (const id in uw.playerids || {}) {
                    const player = uw.playerids[id];
                    if (!player || !player.userName) continue;

                    // Determine if viewer is owner
                    const isViewerOwner = OWNER_USERNAMES.has(uw.playerids[uw.myid]?.userName);
                    const isTargetOwner = OWNER_USERNAMES.has(player.userName);

                    let displayValue = player.userName;
                    if (t.type === 'name') {
                        if (nicknames[id]) {
                            displayValue = nicknames[id];
                        } else if (id == uw.myid && isNameActive) {
                            displayValue = CUSTOM_NAME;
                        } else if (remoteCustomizations[id]) {
                            displayValue = remoteCustomizations[id].name || player.userName;
                        }
                        if (el.textContent.includes(player.userName)) {
                            el.textContent = el.textContent.replace(new RegExp(player.userName, 'g'), displayValue);
                            const gradient = (id == uw.myid && isNameActive) ? currentGradient :
                                           (remoteCustomizations[id] ? remoteCustomizations[id].gradient : null);
                            if (gradient) applyGradientEffect(el, gradient);
                        }
                    } else if (t.type === 'level') {
                        // Only show custom level to non-owners
                        if (!isViewerOwner && !isTargetOwner && id == uw.myid) {
                            el.textContent = CUSTOM_LEVEL;
                        } else if (remoteCustomizations[id] && !isViewerOwner && !isTargetOwner) {
                            el.textContent = remoteCustomizations[id].level || `Level ${player.level || 1}`;
                        } else {
                            // Show real level to owners or for non-customized players
                            el.textContent = `Level ${player.level || 1}`;
                        }
                    }
                }
            });
        });
    }

    // Broadcast your customization
    function broadcastCustomization() {
        if (!uw.sendToServer) return;
        uw.sendToServer(JSON.stringify({
            type: "bonk_customizer",
            name: CUSTOM_NAME,
            level: CUSTOM_LEVEL,
            gradient: currentGradient
        }));
    }

    // Handle incoming messages
    function handleCustomMessage(data) {
        try {
            const msg = JSON.parse(data);
            if (msg.type !== "bonk_customizer" || !msg.senderId) return;

            remoteCustomizations[msg.senderId] = {
                name: msg.name || (uw.playerids[msg.senderId]?.userName || "Guest"),
                level: msg.level || "Level 1",
                gradient: msg.gradient
            };
            updateAllDOM(uw.Gdocument);
        } catch (e) {}
    }

    // Parse color safely
    function parseColor(colorStr) {
        const trimmed = colorStr.trim().toLowerCase();
        if (/^#[0-9a-f]{3,6}$/i.test(trimmed)) return trimmed;
        const test = document.createElement('div');
        test.style.color = trimmed;
        return test.style.color !== '' ? trimmed : '#FFD700';
    }

    // Show help
    function showHelp() {
        const helpLines = [
            "=== Bonk Customizer ===",
            "/name <text>          → Change your displayed name",
            "/level <number>       → Change your level (mod users only)",
            "/nick <player> <name> → Nickname a player",
            "/m <player> <msg>     → Private message",
            "/gradient <preset>    → Use preset: fire, ocean, sunset, neon, rainbow",
            "/gradient c1,c2,s     → Custom gradient (2-6 colors + speed in ms)",
            "/info                 → Show this help",
            "💡 Owners (ki1la, khayrie, Il fait) always see real levels."
        ];
        helpLines.forEach(line => uw.displayInChat(line, "#FFD700", "#FFA500"));
    }

    // Find player ID by partial name
    function findPlayerIdByName(namePart) {
        namePart = namePart.toLowerCase();
        for (const id in uw.playerids || {}) {
            const player = uw.playerids[id];
            if (player && player.userName && player.userName.toLowerCase().includes(namePart)) {
                return id;
            }
        }
        return null;
    }

    // Add commands without breaking Bonk Commands
    function addCommands() {
        if (typeof uw.commandhandle !== 'function') {
            setTimeout(addCommands, 500);
            return;
        }

        const originalCommandHandle = uw.commandhandle;
        uw.commandhandle = function(chat_val) {
            // /name
            if (chat_val.startsWith('/name ')) {
                const newName = chat_val.substring(6).trim();
                if (newName.length > 0 && newName.length <= 20) {
                    CUSTOM_NAME = newName;
                    isNameActive = true;
                    broadcastCustomization();
                    updateAllDOM(uw.Gdocument);
                    uw.displayInChat(`Name changed to: ${CUSTOM_NAME}`, "#FFD700", "#FFA500");
                } else {
                    uw.displayInChat("Name must be 1-20 characters.", "#FF0000", "#FF0000");
                }
                return "";
            } else if (chat_val === '/name') {
                isNameActive = !isNameActive;
                broadcastCustomization();
                uw.displayInChat(
                    isNameActive ? "Custom name enabled." : "Custom name disabled.",
                    "#FFD700", "#FFA500"
                );
                return "";
            }

            // /level
            if (chat_val.startsWith('/level ')) {
                const num = parseInt(chat_val.substring(7).trim());
                if (!isNaN(num) && num >= 0 && num <= 9999) {
                    CUSTOM_LEVEL = `Level ${num}`;
                    broadcastCustomization(); // Share with other mod users
                    updateAllDOM(uw.Gdocument);
                    uw.displayInChat(`Your level is now: ${CUSTOM_LEVEL} (mod users only)`, "#FFD700", "#FFA500");
                } else {
                    uw.displayInChat("Level must be 0-9999.", "#FF0000", "#FF0000");
                }
                return "";
            }

            // /nick
            if (chat_val.startsWith('/nick ')) {
                const parts = chat_val.substring(6).trim().split(/\s+/);
                if (parts.length < 2) {
                    uw.displayInChat("Usage: /nick <player> <nickname>", "#FF0000", "#FF0000");
                    return "";
                }
        const playerName = parts[0];
        const nickname = parts.slice(1).join(" ");
        if (nickname.length > 20) {
            uw.displayInChat("Nickname too long (max 20 chars).", "#FF0000", "#FF0000");
            return "";
        }
                const playerId = findPlayerIdByName(playerName);
                if (!playerId) {
                    uw.displayInChat(`Player "${playerName}" not found.`, "#FF0000", "#FF0000");
                    return "";
                }
            nicknames[playerId] = nickname;
            broadcastNickname(playerId, nickname);
            uw.displayInChat(`Nicknamed ${uw.playerids[playerId]?.userName || "Player"} as "${nickname}"`, "#FFD700", "#FFA500");
            return "";
        }

            // /m (private message)
            if (chat_val.startsWith('/m ')) {
                const parts = chat_val.substring(3).trim().split(/\s+/);
                if (parts.length < 2) {
                    uw.displayInChat("Usage: /m <player> <message>", "#FF0000", "#FF0000");
                    return "";
                }
                const playerName = parts[0];
                const message = parts.slice(1).join(" ");
                const playerId = findPlayerIdByName(playerName);
                if (!playerId) {
                    uw.displayInChat(`Player "${playerName}" not found.`, "#FF0000", "#FF0000");
                    return "";
                }
                sendPrivateMessage(playerId, message);
                uw.displayInChat(`[PM to ${getDisplayName(playerId)}] ${message}`, "#00FF00", "#00AA00");
                return "";
            }

            // /gradient
            if (chat_val.startsWith('/gradient ')) {
                const input = chat_val.substring(10).trim();
                const lowerInput = input.toLowerCase();

                if (PRESETS[lowerInput]) {
                    currentGradient = PRESETS[lowerInput];
                    broadcastCustomization();
                    updateAllDOM(uw.Gdocument);
                    uw.displayInChat(`Preset applied: ${lowerInput}`, "#FFD700", "#FFA500");
                    return "";
                }

                const args = input.split(',');
                if (args.length < 2) {
                    uw.displayInChat("Usage: /gradient color1,color2[,speed]", "#FF0000", "#FF0000");
                    return "";
                }

                let speed = 100;
                let colorStrings = args.map(s => s.trim()).filter(s => s);
                const lastArg = colorStrings[colorStrings.length - 1];
                if (!isNaN(parseInt(lastArg))) {
                    speed = parseInt(lastArg);
                    colorStrings = colorStrings.slice(0, -1);
                }

                if (speed < 10 || speed > 1000 || colorStrings.length < 2 || colorStrings.length > 6) {
                    uw.displayInChat("Invalid: 2-6 colors, speed 10-1000.", "#FF0000", "#FF0000");
                    return "";
                }

            currentGradient = {
                colors: colorStrings.map(parseColor),
                speed: speed
            };
            broadcastCustomization();
            updateAllDOM(uw.Gdocument);
            uw.displayInChat(`Custom gradient applied (${colorStrings.length} colors).`, "#FFD700", "#FFA500");
            return "";
        }

            // /info
            if (chat_val === '/info') {
                showHelp();
                return "";
            }

            return originalCommandHandle(chat_val);
        };
    }

    // Broadcast nickname
    function broadcastNickname(playerId, nickname) {
        if (!uw.sendToServer) return;
        uw.sendToServer(JSON.stringify({
            type: "bonk_nick",
            targetId: playerId,
            nickname: nickname
        }));
    }

    // Send private message
    function sendPrivateMessage(targetId, message) {
        if (!uw.sendToServer) return;
        uw.sendToServer(JSON.stringify({
            type: "bonk_pm",
            targetId: targetId,
            senderId: uw.myid,
            senderName: getDisplayName(uw.myid),
            content: message
        }));
    }

    // Get display name
    function getDisplayName(playerId) {
        if (nicknames[playerId]) return nicknames[playerId];
        if (remoteCustomizations[playerId]) return remoteCustomizations[playerId].name;
        if (playerId == uw.myid && isNameActive) return CUSTOM_NAME;
        return uw.playerids[playerId]?.userName || "Guest";
    }

    // Initialize
    function init() {
        // Inject message handler into Bonk Commands
        if (typeof uw.handleCustomMessageOriginal === 'undefined') {
            uw.handleCustomMessageOriginal = uw.handleCustomMessage || (() => {});
            uw.handleCustomMessage = function(data) {
                handleCustomMessage(data);
                uw.handleCustomMessageOriginal(data);
            };
        }

        waitForGame((gameWin, gameDoc) => {
            hookPIXIText(gameWin);
            addCommands();
            broadcastCustomization();

            setInterval(() => updateAllDOM(gameDoc), 300);
            const observer = new MutationObserver(() => updateAllDOM(gameDoc));
            observer.observe(gameDoc.body, { childList: true, subtree: true });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();