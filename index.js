"use strict";

const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

let serviceStatus = "Initializing...";
let lastRunTime = "Never";
let totalRuns = 0;

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Discord Game Booster Status</title>
            <style>
                body { background: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; max-width: 400px; width: 100%; }
                .status { font-size: 24px; font-weight: bold; color: #22c55e; margin: 15px 0; }
                .info { color: #94a3b8; font-size: 14px; margin: 5px 0; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Discord Game Booster</h2>
                <div class="status">🟢 I'M ALIVE</div>
                <div class="info"><strong>State:</strong> ${serviceStatus}</div>
                <div class="info"><strong>Last Run Finished:</strong> ${lastRunTime}</div>
                <div class="info"><strong>Total Loops Completed:</strong> ${totalRuns}</div>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`[Server] Web dashboard listening on port ${PORT}`);
});

(async () => {
    const TOKEN = process.env.DISCORD_TOKEN;
    if (!TOKEN) {
        console.error("[Game Time] ERROR: DISCORD_TOKEN environment variable is not set!");
        serviceStatus = "Error: Missing DISCORD_TOKEN";
        return;
    }

    const CONFIG = Object.freeze({
        totalHours: 500000,
        games: 40000,
        batchSize: 500,
        delayMs: 150,
        wobble: false,
        dryRun: false
    });

    const CATALOG_URL = "https://cdn.discordapp.com/detectables/games.json";
    const uuid = () => crypto.randomUUID();
    const sha256 = async value => new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    );
    const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));

    async function fingerprintFor(userId) {
        const machineId = uuid();
        const header = await sha256("pe_header_" + userId);
        const machine = await sha256(machineId + userId);
        const sections = await sha256("pe_section_" + userId);
        const certificate = await sha256("pe_cert_" + userId);
        const mask = await sha256(userId + "https://discord.com/careers");

        const binary = new Uint8Array(146);
        const writer = new DataView(binary.buffer);
        binary[0] = 1;
        binary[1] = 1;
        writer.setBigUint64(2, 65432100n, true);
        writer.setUint32(10, 1690000000, true);
        writer.setUint32(14, 0x02500000, true);
        binary.set(header, 18);
        binary.set(machine, 50);
        binary.set(sections, 82);
        binary.set(certificate, 114);

        for (let i = 1; i < binary.length; i++) {
            binary[i] ^= mask[(i - 1) & 31];
        }

        let str = "";
        for (let i = 0; i < binary.length; i++) str += String.fromCharCode(binary[i]);
        return Buffer.from(str).toString('base64');
    }

    function normalizeGame(app) {
        if (app?.id == null) return null;
        const winExe = app?.executables?.find(entry => entry?.os === "win32" && entry?.name);
        const exeName = winExe
            ? winExe.name.replace(/^>/, "")
            : (!app.executables || app.executables.length === 0)
                ? `${(app.name || "game").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "game"}.exe`
                : null;
        if (!exeName) return null;
        return {
            id: String(app.id),
            name: app?.name ?? "Unknown",
            exe: exeName
        };
    }

    function shuffle(items) {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    }

    function sessionEvents(game, baseMs, fingerprint, state) {
        const durationMs = Math.max(360000, Math.round(baseMs));
        const sessionId = uuid();
        const now = Date.now();
        const start = Math.max(0, now - durationMs);

        const launch = {
            client_track_timestamp: now,
            client_heartbeat_session_id: state.heartbeat,
            game: game.name,
            game_id: game.id,
            verified: true,
            elevated: false,
            is_launcher: false,
            game_platform: "desktop",
            detection_method: "verified_game",
            is_overlay_enabled: false,
            is_overlay_game_enabled: true,
            is_overlay_game_source: "OOP_DEFAULT_DATABASE",
            fullscreen_type: "UNKNOWN",
            hardware_display_count: 1,
            overlay_method: "Disabled",
            activity_status_enabled: true,
            activity_status_shared_guilds: [],
            current_user_status: "online",
            game_detection_enabled: true,
            executable_path: game.exe,
            voice_channel_id: null,
            voice_channel_type: null,
            voice_channel_bitrate: null,
            voice_channel_guild_id: null,
            hidden_by_distributor: false,
            game_metadata: null,
            executable_fingerprint: fingerprint,
            client_performance_cpu: null,
            client_performance_memory: null,
            cpu_core_count: null,
            accessibility_features: 0,
            rendered_locale: "en-US",
            launch_signature: state.signature,
            client_rtc_state: null,
            client_app_state: "focused",
            client_send_timestamp: now
        };

        const events = [
            {
                type: "running_game_heartbeat",
                properties: {
                    client_track_timestamp: start,
                    client_heartbeat_session_id: state.heartbeat,
                    game_id: game.id,
                    game_name: game.name,
                    game_metadata: null,
                    game_executable: game.exe,
                    game_detection_enabled: true,
                    initial_heartbeat: true,
                    final_heartbeat: false,
                    game_session_id: sessionId,
                    duration_tracked_ms: 0,
                    rtc_connection_id: null,
                    media_session_id: null,
                    launch_signature: state.signature,
                    client_app_state: "focused",
                    client_send_timestamp: start
                }
            },
            { type: "launch_game", properties: launch },
            {
                type: "running_game_heartbeat",
                properties: {
                    client_track_timestamp: now,
                    client_heartbeat_session_id: state.heartbeat,
                    game_id: game.id,
                    game_name: game.name,
                    game_metadata: null,
                    game_executable: game.exe,
                    game_detection_enabled: true,
                    initial_heartbeat: false,
                    final_heartbeat: true,
                    game_session_id: sessionId,
                    duration_tracked_ms: durationMs,
                    rtc_connection_id: null,
                    media_session_id: null,
                    launch_signature: state.signature,
                    client_app_state: "focused",
                    client_send_timestamp: now
                }
            }
        ];

        for (const event of events) {
            event.properties.event_sequence_number = ++state.sequence;
        }
        return { events, hours: durationMs / 3600000 };
    }

    async function getAuthContext() {
        const res = await fetch("https://discord.com/api/v9/users/@me", {
            headers: {
                "Authorization": TOKEN,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });
        if (!res.ok) throw new Error("Invalid token or unauthorized request to /users/@me");
        const profile = await res.json();
        const userId = String(profile.id);
        return {
            analyticsToken: profile.analytics_token || "",
            username: profile.username || "user",
            fingerprint: await fingerprintFor(userId)
        };
    }

    async function getCatalog() {
        let apps = null;
        try {
            const res = await fetch(CATALOG_URL);
            if (res.ok) apps = await res.json();
        } catch (_) {}
        if (!Array.isArray(apps)) throw new Error("The detectable-game catalog is unavailable.");

        let uniqueList = [];
        const unique = new Map();
        for (const app of apps) {
            const game = normalizeGame(app);
            if (game && !unique.has(game.id)) {
                unique.set(game.id, game);
                uniqueList.push(game);
            }
        }
        while (uniqueList.length < CONFIG.games && uniqueList.length > 0) {
            const copy = uniqueList.map(g => ({ ...g, id: g.id + "_" + Math.random().toString(36).substring(2, 7) }));
            uniqueList.push(...copy);
        }
        return uniqueList.slice(0, CONFIG.games);
    }

    async function sendBatch(events, analyticsToken) {
        if (CONFIG.dryRun) return true;
        try {
            const res = await fetch("https://discord.com/api/v9/science", {
                method: "POST",
                headers: {
                    "Authorization": TOKEN,
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                body: JSON.stringify({ token: analyticsToken, events })
            });
            if (res.ok || res.status === 204) return true;
            if (res.status === 429) {
                console.warn("[Game Time] Rate limited; cooling down 5s.");
                await wait(5);
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    while (true) {
        try {
            serviceStatus = "Running boost cycle...";
            console.log("[Game Time] Starting new execution cycle...");

            const context = await getAuthContext();
            const catalog = shuffle(await getCatalog());
            const selected = catalog.slice(0, CONFIG.games);
            const hoursPerGame = CONFIG.totalHours / selected.length;
            const baseDurationMs = Math.round(hoursPerGame * 3600 * 1000);

            const state = { heartbeat: uuid(), signature: uuid(), sequence: 0 };
            let credited = 0;
            let forgedCount = 0;
            const totalBatches = Math.ceil(selected.length / CONFIG.batchSize);

            for (let offset = 0; offset < selected.length; offset += CONFIG.batchSize) {
                const chunk = selected.slice(offset, offset + CONFIG.batchSize);
                const allEvents = [];
                let chunkHours = 0;

                for (const game of chunk) {
                    const result = sessionEvents(game, baseDurationMs, context.fingerprint, state);
                    allEvents.push(...result.events);
                    chunkHours += result.hours;
                }

                const batchNum = Math.floor(offset / CONFIG.batchSize) + 1;
                const accepted = await sendBatch(allEvents, context.analyticsToken);

                if (accepted) {
                    forgedCount += chunk.length;
                    credited += chunkHours;
                    console.log(`[Game Time] Batch ${batchNum}/${totalBatches} accepted (+${chunkHours.toFixed(1)}h, total ${credited.toFixed(0)}h)`);
                } else {
                    console.warn(`[Game Time] Batch ${batchNum}/${totalBatches} was rejected.`);
                }

                await wait(CONFIG.delayMs / 1000);
            }

            totalRuns++;
            lastRunTime = new Date().toLocaleString();
            serviceStatus = `Idle (Completed ${totalRuns} runs successfully)`;
            console.log(`[Game Time] Cycle complete. Total credited: ${credited.toFixed(0)}h. Waiting before restart...`);

        } catch (err) {
            console.error("[Game Time] Error in loop:", err.message);
            serviceStatus = `Error: ${err.message}`;
        }

        await wait(300);
    }
})();
