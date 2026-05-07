const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

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

async function fetchHistory() {
  const res = await fetch(`https://puddle.farm/api/player/${PLAYER_ID}/${CHAR_SHORT}/history?count=10`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.history || [];
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
});

// ─── STARTUP ───────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Commands: !dr, !stats, !history`);
  poll();
  setInterval(poll, POLL_INTERVAL);
});

if (!DISCORD_TOKEN) { console.error("❌ Set DISCORD_TOKEN"); process.exit(1); }
if (!CHANNEL_ID)     { console.error("❌ Set CHANNEL_ID");     process.exit(1); }

client.login(DISCORD_TOKEN);
