const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const sharp = require("/home/claude/.npm-global/lib/node_modules/sharp");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const POLL_INTERVAL  = 60_000;
const PREFIX         = "!";

const PLAYER_ID  = "210720021753002458";
const CHAR_SHORT = "JN";  // Johnny
const API_URL    = `https://puddle.farm/api/player/${PLAYER_ID}`;
// ───────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

let lastDR         = null;
let lastDeviation  = null;
let lastMatchCount = null;

async function fetchDR() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const charData = data.ratings?.find(r => r.char_short === CHAR_SHORT);
  if (!charData) throw new Error(`Character ${CHAR_SHORT} not found for player`);

  return {
    playerName: data.name,
    rating:     Math.round(charData.rating) % 10000,
    deviation:  Math.round(charData.deviation),
    matchCount: charData.match_count,
    topChar:    charData.top_char,
    topRating:  charData.top_rating ? Math.round(charData.top_rating.value) % 10000 : null,
  };
}

async function fetchHistory(count = 10) {
  const res = await fetch(`https://puddle.farm/api/player/${PLAYER_ID}/${CHAR_SHORT}/history?count=${count}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.history || [];
}

// Fetch all of today's matches (fetches up to 200, filters by local date)
async function fetchTodayMatches() {
  const history = await fetchHistory(200);
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
  return history.filter(match => {
    if (!match.timestamp) return false;
    const matchDate = new Date(match.timestamp).toLocaleDateString("en-CA");
    return matchDate === todayStr;
  });
}

// ─── GRAPH GENERATION ──────────────────────────────────────────────────────

function buildGraphSVG(playerName, matches) {
  // matches are oldest→newest; each has own_rating_value and timestamp
  // Build the DR series: starting point (before first match) + each match result
  const W = 800, H = 400;
  const PAD = { top: 50, right: 40, bottom: 60, left: 70 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Build points array: derive "DR before first match" from first match's before-value if available,
  // otherwise just use all post-match DRs
  const drs = matches.map(m => Math.round(m.own_rating_value) % 10000);

  // Center the y-axis around the data
  const minDR = Math.min(...drs);
  const maxDR = Math.max(...drs);
  const rangePad = Math.max(20, Math.round((maxDR - minDR) * 0.3));
  const yMin = minDR - rangePad;
  const yMax = maxDR + rangePad;

  const xScale = i => PAD.left + (i / (drs.length - 1 || 1)) * innerW;
  const yScale = v => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  // Build polyline points
  const pts = drs.map((dr, i) => `${xScale(i).toFixed(1)},${yScale(dr).toFixed(1)}`).join(" ");

  // Build filled area path
  const firstX = xScale(0).toFixed(1);
  const lastX  = xScale(drs.length - 1).toFixed(1);
  const baseY  = (PAD.top + innerH).toFixed(1);
  const areaPath = `M ${firstX},${baseY} ` +
    drs.map((dr, i) => `L ${xScale(i).toFixed(1)},${yScale(dr).toFixed(1)}`).join(" ") +
    ` L ${lastX},${baseY} Z`;

  // Y axis ticks
  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    yMin + Math.round(((yMax - yMin) / tickCount) * i)
  );

  // X axis labels: show time for first, last, and a few in between
  const labelIndices = new Set([0, drs.length - 1]);
  if (drs.length > 4) {
    const mid = Math.floor(drs.length / 2);
    labelIndices.add(mid);
  }
  const timeLabel = ts => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  };

  // Net DR change
  const netChange = drs[drs.length - 1] - drs[0];
  const netStr    = netChange >= 0 ? `+${netChange}` : `${netChange}`;
  const lineColor = netChange >= 0 ? "#57f287" : "#ed4245";
  const areaColor = netChange >= 0 ? "#57f28730" : "#ed424530";

  // Dot markers (wins/losses)
  const dots = drs.map((dr, i) => {
    const win = matches[i].result_win;
    const cx  = xScale(i).toFixed(1);
    const cy  = yScale(dr).toFixed(1);
    const fill = win ? "#57f287" : "#ed4245";
    return `<circle cx="${cx}" cy="${cy}" r="5" fill="${fill}" stroke="#1e1f22" stroke-width="2"/>`;
  }).join("\n    ");

  const yTickLines = yTicks.map(t => {
    const y = yScale(t).toFixed(1);
    return `
    <line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#3a3b40" stroke-width="1"/>
    <text x="${PAD.left - 8}" y="${y}" fill="#9b9ea4" font-size="12" text-anchor="end" dominant-baseline="middle">${t}</text>`;
  }).join("");

  const xTickLabels = [...labelIndices].map(i => {
    const x   = xScale(i).toFixed(1);
    const lbl = timeLabel(matches[i].timestamp);
    return `<text x="${x}" y="${PAD.top + innerH + 22}" fill="#9b9ea4" font-size="11" text-anchor="middle">${lbl}</text>`;
  }).join("\n    ");

  // Sanitize playerName so non-ASCII characters don't break SVG text rendering
  const safeName = playerName.replace(/[^\x20-\x7E]/g, "?");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>text { font-family: monospace; }</style>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="12" fill="#2b2d31"/>

  <!-- Grid lines + Y labels -->
  ${yTickLines}

  <!-- Area fill -->
  <path d="${areaPath}" fill="${areaColor}"/>

  <!-- Line -->
  <polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>

  <!-- Dots -->
  ${dots}

  <!-- X labels -->
  ${xTickLabels}

  <!-- Title -->
  <text x="${W / 2}" y="28" fill="#ffffff" font-size="16" font-weight="bold" text-anchor="middle">${safeName} (Johnny) - Today's DR</text>

  <!-- Net change badge -->
  <rect x="${W - PAD.right - 80}" y="8" width="75" height="26" rx="6" fill="${lineColor}22" stroke="${lineColor}" stroke-width="1.2"/>
  <text x="${W - PAD.right - 42}" y="25" fill="${lineColor}" font-size="14" font-weight="bold" text-anchor="middle">${netStr} DR</text>

  <!-- Games label -->
  <text x="${PAD.left}" y="25" fill="#9b9ea4" font-size="12">${matches.length} game${matches.length !== 1 ? "s" : ""} today</text>

  <!-- Axis line -->
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + innerH}" stroke="#4a4b50" stroke-width="1.5"/>
  <line x1="${PAD.left}" y1="${PAD.top + innerH}" x2="${W - PAD.right}" y2="${PAD.top + innerH}" stroke="#4a4b50" stroke-width="1.5"/>
</svg>`;
}

async function renderGraphPNG(playerName, matches) {
  const svg = buildGraphSVG(playerName, matches);
  const buf = Buffer.from(svg, "utf8");
  return sharp(buf).png().toBuffer();
}

// ─── EMBEDS ────────────────────────────────────────────────────────────────

function drUpdateEmbed(playerName, current, previous) {
  const diff        = current.rating - previous.rating;
  const diffStr     = diff >= 0 ? `+${diff}` : `${diff}`;
  const arrow       = diff > 0 ? "📈" : diff < 0 ? "📉" : "➡️";
  const color       = diff > 0 ? 0x57f287 : diff < 0 ? 0xed4245 : 0x5865f2;
  const gamesPlayed = current.matchCount - previous.matchCount;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${arrow} DR Update — ${playerName} (Johnny)`)
    .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
    .addFields(
      { name: "New DR",             value: `**${current.rating}**`,                        inline: true },
      { name: "Change",             value: `**${diffStr}**`,                               inline: true },
      { name: "Old DR",             value: `${previous.rating}`,                           inline: true },
      { name: "Games This Session", value: `+${gamesPlayed} game${gamesPlayed !== 1 ? "s" : ""}`, inline: true },
      { name: "Total Games",        value: `${current.matchCount.toLocaleString()}`,       inline: true },
      { name: "Char Rank",          value: current.topChar ? `#${current.topChar}` : "—", inline: true },
    )
    .setFooter({ text: "puddle.farm • Guilty Gear Strive" })
    .setTimestamp();
}

function drCheckEmbed(current) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎴 Current DR — ${current.playerName} (Johnny)`)
    .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
    .addFields(
      { name: "DR",          value: `**${current.rating}**`,                        inline: true },
      { name: "Deviation",   value: `±${current.deviation}`,                        inline: true },
      { name: "Char Rank",   value: current.topChar ? `#${current.topChar}` : "—", inline: true },
    )
    .setFooter({ text: "puddle.farm • Guilty Gear Strive" })
    .setTimestamp();
}

function statsEmbed(current) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`📊 Stats — ${current.playerName} (Johnny)`)
    .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
    .addFields(
      { name: "Current DR",  value: `**${current.rating}**`,                        inline: true },
      { name: "Deviation",   value: `±${current.deviation}`,                        inline: true },
      { name: "Char Rank",   value: current.topChar ? `#${current.topChar}` : "—", inline: true },
      { name: "Total Games", value: `${current.matchCount.toLocaleString()}`,       inline: true },
      { name: "Peak DR",     value: current.topRating ? `${current.topRating}` : "—", inline: true },
    )
    .setFooter({ text: "puddle.farm • Guilty Gear Strive" })
    .setTimestamp();
}

function historyEmbed(playerName, history) {
  const lines = history.map(match => {
    const result  = match.result_win ? "✅" : "❌";
    const drAfter = Math.round(match.own_rating_value) % 10000;
    const opp     = match.opponent_name;
    const oppChar = match.opponent_character;
    return `${result} vs **${opp}** (${oppChar}) — DR: ${drAfter}`;
  });

  return new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle(`📜 Recent Matches — ${playerName} (Johnny)`)
    .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
    .setDescription(lines.join("\n") || "No matches found.")
    .setFooter({ text: "Last 10 matches • puddle.farm" })
    .setTimestamp();
}

function todayEmbed(playerName, matches, currentDR) {
  if (matches.length === 0) {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📅 Today — ${playerName} (Johnny)`)
      .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
      .setDescription("No games played today yet.")
      .setFooter({ text: "puddle.farm • Guilty Gear Strive" })
      .setTimestamp();
  }

  const drs      = matches.map(m => Math.round(m.own_rating_value) % 10000);
  const startDR  = drs[0];
  const endDR    = drs[drs.length - 1];
  const netChange = endDR - startDR;
  const diffStr  = netChange >= 0 ? `+${netChange}` : `${netChange}`;
  const color    = netChange > 0 ? 0x57f287 : netChange < 0 ? 0xed4245 : 0x5865f2;
  const arrow    = netChange > 0 ? "📈" : netChange < 0 ? "📉" : "➡️";
  const wins     = matches.filter(m => m.result_win).length;
  const losses   = matches.length - wins;
  const peakDR   = Math.max(...drs);
  const lowDR    = Math.min(...drs);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${arrow} Today — ${playerName} (Johnny)`)
    .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
    .addFields(
      { name: "Games Today",  value: `${matches.length}`,          inline: true },
      { name: "Record",       value: `${wins}W — ${losses}L`,      inline: true },
      { name: "Net DR",       value: `**${diffStr}**`,             inline: true },
      { name: "Start DR",     value: `${startDR}`,                 inline: true },
      { name: "Current DR",   value: `**${currentDR}**`,           inline: true },
      { name: "\u200b",       value: "\u200b",                     inline: true },
      { name: "Peak DR",      value: `${peakDR}`,                  inline: true },
      { name: "Low DR",       value: `${lowDR}`,                   inline: true },
      { name: "\u200b",       value: "\u200b",                     inline: true },
    )
    .setFooter({ text: "puddle.farm • Guilty Gear Strive" })
    .setTimestamp();
}

// ─── POLLING ───────────────────────────────────────────────────────────────

async function poll() {
  try {
    const current = await fetchDR();

    if (lastDR === null) {
      console.log(`[boot] ${current.playerName} DR: ${current.rating} | Games: ${current.matchCount}`);
      lastDR         = current.rating;
      lastDeviation  = current.deviation;
      lastMatchCount = current.matchCount;
      return;
    }

    if (current.rating !== lastDR) {
      const previous = { rating: lastDR, deviation: lastDeviation, matchCount: lastMatchCount };
      const channel  = await client.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [drUpdateEmbed(current.playerName, current, previous)] });
      console.log(`[update] DR: ${lastDR} → ${current.rating}`);
      lastDR         = current.rating;
      lastDeviation  = current.deviation;
      lastMatchCount = current.matchCount;
    } else {
      console.log(`[poll] No change. DR: ${current.rating}`);
    }
  } catch (err) {
    console.error("[poll error]", err.message);
  }
}

// ─── COMMANDS ──────────────────────────────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const command = message.content.slice(PREFIX.length).trim().toLowerCase();

  if (command === "dr") {
    try {
      const current = await fetchDR();
      await message.reply({ embeds: [drCheckEmbed(current)] });
    } catch (err) {
      await message.reply("❌ Could not fetch DR right now, try again later.");
    }
  }

  else if (command === "stats") {
    try {
      const current = await fetchDR();
      await message.reply({ embeds: [statsEmbed(current)] });
    } catch (err) {
      await message.reply("❌ Could not fetch stats right now, try again later.");
    }
  }

  else if (command === "is gavin 1700 yet") {
    try {
      const current = await fetchDR();
      if (current.rating >= 1700) {
        await message.reply("Yes.");
      } else {
        await message.reply("No.");
      }
    } catch (err) {
      await message.reply("❌ Could not fetch DR right now, try again later.");
    }
  }

  else if (command === "history") {
    try {
      const [current, history] = await Promise.all([fetchDR(), fetchHistory()]);
      await message.reply({ embeds: [historyEmbed(current.playerName, history)] });
    } catch (err) {
      await message.reply("❌ Could not fetch history right now, try again later.");
    }
  }

  else if (command === "today") {
    try {
      const [current, matches] = await Promise.all([fetchDR(), fetchTodayMatches()]);
      await message.reply({ embeds: [todayEmbed(current.playerName, matches, current.rating)] });
    } catch (err) {
      console.error("[today error]", err);
      await message.reply("❌ Could not fetch today's data right now, try again later.");
    }
  }

  else if (command === "graph") {
    try {
      const [current, matches] = await Promise.all([fetchDR(), fetchTodayMatches()]);

      if (matches.length < 2) {
        await message.reply(
          matches.length === 0
            ? "📅 No games played today yet — nothing to graph!"
            : "📅 Only 1 game today — need at least 2 to draw a graph."
        );
        return;
      }

      const pngBuf    = await renderGraphPNG(current.playerName, matches);
      const attach    = new AttachmentBuilder(pngBuf, { name: "graph.png" });
      const drs       = matches.map(m => Math.round(m.own_rating_value) % 10000);
      const netChange = drs[drs.length - 1] - drs[0];
      const netStr    = netChange >= 0 ? `+${netChange}` : `${netChange}`;
      const color     = netChange > 0 ? 0x57f287 : netChange < 0 ? 0xed4245 : 0x5865f2;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📊 Today's DR Graph — ${current.playerName} (Johnny)`)
        .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
        .setDescription(`**${matches.length}** games · Net **${netStr}** DR`)
        .setImage("attachment://graph.png")
        .setFooter({ text: "puddle.farm • Guilty Gear Strive" })
        .setTimestamp();

      await message.reply({ embeds: [embed], files: [attach] });
    } catch (err) {
      console.error("[graph error]", err);
      await message.reply("❌ Could not generate graph right now, try again later.");
    }
  }
});

// ─── STARTUP ───────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Commands: !dr, !stats, !history, !today, !graph`);
  poll();
  setInterval(poll, POLL_INTERVAL);
});

if (!DISCORD_TOKEN) { console.error("❌ Set DISCORD_TOKEN"); process.exit(1); }
if (!CHANNEL_ID)     { console.error("❌ Set CHANNEL_ID");     process.exit(1); }

client.login(DISCORD_TOKEN);
 
client.login(DISCORD_TOKEN);
 
