const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

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

const chart = new ChartJSNodeCanvas({ width: 800, height: 400, backgroundColour: "#2b2d31" });
const chartSquare = new ChartJSNodeCanvas({ width: 500, height: 500, backgroundColour: "#2b2d31" });

let lastDR         = null;
let lastDeviation  = null;
let lastMatchCount = null;

function fmt(n) { return Math.round(n) % 10000; }

async function fetchDR() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const charData = data.ratings?.find(r => r.char_short === CHAR_SHORT);
  if (!charData) throw new Error(`Character ${CHAR_SHORT} not found`);
  return {
    playerName: data.name,
    rating:     fmt(charData.rating),
    deviation:  Math.round(charData.deviation),
    matchCount: charData.match_count,
    topChar:    charData.top_char,
    topRating:  charData.top_rating ? fmt(charData.top_rating.value) : null,
  };
}

async function fetchHistory(count = 100) {
  const res = await fetch(`https://puddle.farm/api/player/${PLAYER_ID}/${CHAR_SHORT}/history?count=${count}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.history || [];
}

// ─── CHARTS ────────────────────────────────────────────────────────────────

async function generateDRChart(history) {
  const reversed = [...history].reverse();
  const labels   = reversed.map((_, i) => `#${i + 1}`);
  const data     = reversed.map(m => fmt(m.own_rating_value));

  return chart.renderToBuffer({
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "DR",
        data,
        borderColor: "#5865f2",
        backgroundColor: "rgba(88,101,242,0.15)",
        pointBackgroundColor: reversed.map(m => m.result_win ? "#57f287" : "#ed4245"),
        pointRadius: 5,
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: "#fff" } },
        title: { display: true, text: "DR Over Recent Matches (green=win, red=loss)", color: "#fff", font: { size: 15 } }
      },
      scales: {
        x: { ticks: { color: "#aaa", maxTicksLimit: 20 }, grid: { color: "#444" } },
        y: { ticks: { color: "#aaa" }, grid: { color: "#444" } }
      }
    }
  });
}

async function generateWinLossChart(history) {
  const wins   = history.filter(m => m.result_win).length;
  const losses = history.filter(m => !m.result_win).length;
  const pct    = Math.round((wins / history.length) * 100);

  return chart.renderToBuffer({
    type: "bar",
    data: {
      labels: ["Wins", "Losses"],
      datasets: [{
        label: "Games",
        data: [wins, losses],
        backgroundColor: ["#57f287", "#ed4245"],
        borderRadius: 8,
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: `Win/Loss — Last ${history.length} Matches (${pct}% winrate)`, color: "#fff", font: { size: 15 } }
      },
      scales: {
        x: { ticks: { color: "#fff" }, grid: { color: "#444" } },
        y: { ticks: { color: "#aaa" }, grid: { color: "#444" }, beginAtZero: true }
      }
    }
  });
}

async function generateMatchupChart(history) {
  // Build per-character stats
  const stats = {};
  for (const m of history) {
    const char = m.opponent_character || "Unknown";
    if (!stats[char]) stats[char] = { wins: 0, total: 0 };
    stats[char].total++;
    if (m.result_win) stats[char].wins++;
  }

  // Sort by most played, take top 10
  const sorted = Object.entries(stats)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  const labels   = sorted.map(([char, s]) => `${char} (${s.total})`);
  const winRates = sorted.map(([, s]) => Math.round((s.wins / s.total) * 100));

  // Color each bar: green if >50%, red if <50%, yellow if 50%
  const colors = winRates.map(r => r > 50 ? "#57f287" : r < 50 ? "#ed4245" : "#fee75c");

  return chartSquare.renderToBuffer({
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Win Rate %",
        data: winRates,
        backgroundColor: colors,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Win Rate by Character (top 10 most played)", color: "#fff", font: { size: 14 } }
      },
      scales: {
        x: {
          ticks: { color: "#aaa", callback: v => `${v}%` },
          grid: { color: "#444" },
          min: 0, max: 100
        },
        y: { ticks: { color: "#fff" }, grid: { color: "#444" } }
      }
    }
  });
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
      { name: "DR",        value: `**${current.rating}**`,                        inline: true },
      { name: "Deviation", value: `±${current.deviation}`,                        inline: true },
      { name: "Char Rank", value: current.topChar ? `#${current.topChar}` : "—", inline: true },
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
  const lines = history.slice(0, 10).map(match => {
    const result  = match.result_win ? "✅" : "❌";
    const drAfter = fmt(match.own_rating_value);
    return `${result} vs **${match.opponent_name}** (${match.opponent_character}) — DR: ${drAfter}`;
  });
  return new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle(`📜 Recent Matches — ${playerName} (Johnny)`)
    .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
    .setDescription(lines.join("\n") || "No matches found.")
    .setFooter({ text: "Last 10 matches • puddle.farm" })
    .setTimestamp();
}

// ─── POLLING ───────────────────────────────────────────────────────────────

async function poll() {
  try {
    const current = await fetchDR();
    if (lastDR === null) {
      console.log(`[boot] ${current.playerName} DR: ${current.rating} | Games: ${current.matchCount}`);
      lastDR = current.rating; lastDeviation = current.deviation; lastMatchCount = current.matchCount;
      return;
    }
    if (current.rating !== lastDR) {
      const previous = { rating: lastDR, deviation: lastDeviation, matchCount: lastMatchCount };
      const channel  = await client.channels.fetch(CHANNEL_ID);
      await channel.send({ embeds: [drUpdateEmbed(current.playerName, current, previous)] });
      console.log(`[update] DR: ${lastDR} → ${current.rating}`);
      lastDR = current.rating; lastDeviation = current.deviation; lastMatchCount = current.matchCount;
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
    } catch { await message.reply("❌ Could not fetch DR right now."); }
  }

  else if (command === "stats") {
    try {
      const current = await fetchDR();
      await message.reply({ embeds: [statsEmbed(current)] });
    } catch { await message.reply("❌ Could not fetch stats right now."); }
  }

  else if (command === "history") {
    try {
      const [current, history] = await Promise.all([fetchDR(), fetchHistory(10)]);
      await message.reply({ embeds: [historyEmbed(current.playerName, history)] });
    } catch { await message.reply("❌ Could not fetch history right now."); }
  }

  else if (command === "is gavin 1700 yet") {
    try {
      const current = await fetchDR();
      await message.reply(current.rating >= 1700 ? "Yes." : "No.");
    } catch { await message.reply("❌ Could not fetch DR right now."); }
  }

  else if (command === "chart") {
    try {
      await message.reply("📊 Generating charts, one moment...");
      const history = await fetchHistory(100);
      if (history.length === 0) { await message.reply("❌ No match history found."); return; }

      const [drBuf, wlBuf, muBuf] = await Promise.all([
        generateDRChart(history),
        generateWinLossChart(history),
        generateMatchupChart(history),
      ]);

      await message.channel.send({
        content: `📈 **DR Over Time** — last ${history.length} matches`,
        files: [new AttachmentBuilder(drBuf, { name: "dr_chart.png" })]
      });
      await message.channel.send({
        content: "🟩 **Win / Loss Breakdown**",
        files: [new AttachmentBuilder(wlBuf, { name: "winloss_chart.png" })]
      });
      await message.channel.send({
        content: "🎮 **Win Rate by Character** (top 10 most played)",
        files: [new AttachmentBuilder(muBuf, { name: "matchup_chart.png" })]
      });
    } catch (err) {
      console.error(err);
      await message.reply("❌ Could not generate charts right now.");
    }
  }
});

// ─── STARTUP ───────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Commands: !dr  !stats  !history  !chart  !is gavin 1700 yet`);
  poll();
  setInterval(poll, POLL_INTERVAL);
});

if (!DISCORD_TOKEN) { console.error("❌ Set DISCORD_TOKEN"); process.exit(1); }
if (!CHANNEL_ID)     { console.error("❌ Set CHANNEL_ID");     process.exit(1); }

client.login(DISCORD_TOKEN);
