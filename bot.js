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

// ─── GRAPH ─────────────────────────────────────────────────────────────────

async function generateDRGraph(history) {
  // history comes in newest-first; reverse so oldest is on the left
  const ordered = [...history].reverse();

  const labels = ordered.map((_, i) => `G${i + 1}`);
  const drValues = ordered.map(m => Math.round(m.own_rating_value) % 10000);
  const wins = ordered.map(m => m.result_win);

  const minDR = Math.min(...drValues);
  const maxDR = Math.max(...drValues);
  const padding = Math.max(20, Math.round((maxDR - minDR) * 0.25));
  const yMin = minDR - padding;
  const yMax = maxDR + padding;

  // Point colors: green for win, red for loss
  const pointColors = wins.map(w => w ? "rgba(87, 242, 135, 0.9)" : "rgba(237, 66, 69, 0.9)");
  const pointBorderColors = wins.map(w => w ? "rgba(87, 242, 135, 1)" : "rgba(237, 66, 69, 1)");

  const width = 900;
  const height = 450;

  const chartCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "#1e1f22",
  });

  const configuration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "DR",
          data: drValues,
          borderColor: "rgba(88, 101, 242, 1)",
          borderWidth: 2.5,
          backgroundColor: (ctx) => {
            const chart = ctx.chart;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return "transparent";
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(88, 101, 242, 0.35)");
            gradient.addColorStop(1, "rgba(88, 101, 242, 0.01)");
            return gradient;
          },
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      layout: {
        padding: { top: 20, right: 30, bottom: 10, left: 10 },
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `DR History — Last ${history.length} Games (Johnny)`,
          color: "#ffffff",
          font: { size: 18, weight: "bold", family: "sans-serif" },
          padding: { bottom: 16 },
        },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          ticks: {
            color: "#8b8fa8",
            font: { size: 11 },
            maxTicksLimit: 20,
            maxRotation: 0,
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
          },
          border: { color: "rgba(255,255,255,0.1)" },
        },
        y: {
          min: yMin,
          max: yMax,
          ticks: {
            color: "#8b8fa8",
            font: { size: 12 },
            callback: (val) => val.toLocaleString(),
          },
          grid: {
            color: "rgba(255,255,255,0.06)",
          },
          border: { color: "rgba(255,255,255,0.1)" },
        },
      },
    },
  };

  return chartCanvas.renderToBuffer(configuration);
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

  else if (command === "graph") {
    try {
      // Send a "loading" reply first since chart generation takes a moment
      const loadingMsg = await message.reply("📊 Generating graph...");

      const history = await fetchHistory(100);
      if (history.length === 0) {
        await loadingMsg.edit("❌ No match history found.");
        return;
      }

      const imageBuffer = await generateDRGraph(history);
      const attachment  = new AttachmentBuilder(imageBuffer, { name: "dr_graph.png" });

      const wins   = history.filter(m => m.result_win).length;
      const losses = history.length - wins;
      const winrate = ((wins / history.length) * 100).toFixed(1);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📈 DR Graph — Last ${history.length} Games (Johnny)`)
        .setURL(`https://puddle.farm/player/${PLAYER_ID}/${CHAR_SHORT}`)
        .setImage("attachment://dr_graph.png")
        .addFields(
          { name: "Wins",    value: `${wins}`,      inline: true },
          { name: "Losses",  value: `${losses}`,    inline: true },
          { name: "Win Rate",value: `${winrate}%`,  inline: true },
        )
        .setFooter({ text: "🟢 Win  🔴 Loss  •  puddle.farm • Guilty Gear Strive" })
        .setTimestamp();

      await loadingMsg.edit({ content: null, embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error("[graph error]", err);
      await message.reply("❌ Could not generate graph right now, try again later.");
    }
  }
});

// ─── STARTUP ───────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Commands: !dr, !stats, !history, !graph`);
  poll();
  setInterval(poll, POLL_INTERVAL);
});

if (!DISCORD_TOKEN) { console.error("❌ Set DISCORD_TOKEN"); process.exit(1); }
if (!CHANNEL_ID)     { console.error("❌ Set CHANNEL_ID");     process.exit(1); }

client.login(DISCORD_TOKEN);
