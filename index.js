const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Events,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");


// CONFIG
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_CATEGORY_ID = process.env.STAFF_CATEGORY_ID;


const STAFF_ROLE_ID = "";


// DATA FILE

const DATA_FILE = path.join(__dirname, "tickets.json");

function loadData() {
  let parsed = {};

  if (fs.existsSync(DATA_FILE)) {
    try {
      parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (err) {
      console.error("Could not read tickets.json, starting fresh.");
    }
  }

  return {
    userToTicket: parsed.userToTicket || {},
    anonToUser: parsed.anonToUser || {}
  };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const data = loadData();

function makeAnonId() {
  let anonId = "";
  do {
    anonId = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (data.anonToUser[anonId]);
  return anonId;
}

function sanitizeChannelName(anonId) {
  return anonId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function hasStaffAccess(interaction) {
  if (!STAFF_ROLE_ID) return true;
  return interaction.member.roles.cache.has(STAFF_ROLE_ID);
}

function getTicketByChannelId(channelId) {
  for (const anonId in data.anonToUser) {
    const ticket = data.anonToUser[anonId];
    if (ticket.channelId === channelId) {
      return { anonId, ...ticket };
    }
  }
  return null;
}

async function getOrCreateTicket(user) {
  if (data.userToTicket[user.id]) {
    return data.userToTicket[user.id];
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  const anonId = makeAnonId();
  const channelName = sanitizeChannelName(anonId);

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: STAFF_CATEGORY_ID
  });

  const ticket = {
    anonId,
    userId: user.id,
    channelId: channel.id
  };

  data.userToTicket[user.id] = ticket;
  data.anonToUser[anonId] = {
    userId: user.id,
    channelId: channel.id
  };
  saveData(data);

  await channel.send(`**${anonId}** opened a new anonymous thread!\n`);

  return ticket;
}


// CLIENT

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});


// SLASH COMMANDS

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("reply")
      .setDescription("Reply to the anonymous user for this ticket")
      .addStringOption(option =>
        option
          .setName("message")
          .setDescription("Reply message to send")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close the anonymous conversation for this ticket")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered.");
}


// READY

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});


// USER DM -> STAFF CHANNEL

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.channel.type === ChannelType.DM) {
    try {
      const ticket = await getOrCreateTicket(message.author);
      const staffChannel = await client.channels.fetch(ticket.channelId);

      if (!staffChannel) {
        console.error("Staff ticket channel not found.");
        return;
      }

      let content = message.content?.trim();
      if (!content) content = "*[no text message]*";

      await staffChannel.send(`📩 **${ticket.anonId}** says:\n${content}`);

      if (message.attachments.size > 0) {
        const urls = [...message.attachments.values()].map(file => file.url);
        await staffChannel.send(
          `📎 **${ticket.anonId}** attachment(s):\n${urls.join("\n")}`
        );
      }

      await message.channel.send(
        "Thank you for your message to the PE's! We will try to get back to you in 24 hours, and if a response is not given, feel free to DM the bot again with a reminder or any follow-ups :3 We appreciate any and all feedback! Have an awesome day queen <3"
      );
    } catch (err) {
      console.error("Error relaying DM:", err);
    }
  }
});


// STAFF COMMANDS

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.guildId !== GUILD_ID) {
    await interaction.reply({
      content: "This command can only be used in the server.",
      ephemeral: true
    });
    return;
  }

  if (!hasStaffAccess(interaction)) {
    await interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reply") {
    const responseMessage = interaction.options.getString("message");
    const ticket = getTicketByChannelId(interaction.channelId);

    if (!ticket) {
      await interaction.reply({
        content: "This channel is not linked to an anonymous conversation.",
        ephemeral: true
      });
      return;
    }

    try {
      const user = await client.users.fetch(ticket.userId);
      await user.send(`**PE's response to ${ticket.anonId}:**\n${responseMessage}`);

      const staffChannel = await client.channels.fetch(ticket.channelId);
      if (staffChannel) {
        await staffChannel.send(
          `🟦 **Response sent to ${ticket.anonId}:**\n${responseMessage}\n` +
          `— sent by <@${interaction.user.id}>`
        );
      }

      await interaction.reply({
        content: `Sent reply to ${ticket.anonId}.`,
        ephemeral: true
      });
    } catch (err) {
      console.error("Error sending staff reply:", err);
      await interaction.reply({
        content: `Could not send a DM to ${ticket.anonId}.`,
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === "close") {
    const ticket = getTicketByChannelId(interaction.channelId);

    if (!ticket) {
      await interaction.reply({
        content: "This channel is not linked to an anonymous conversation.",
        ephemeral: true
      });
      return;
    }

    try {
      const staffChannel = await client.channels.fetch(ticket.channelId);
      if (staffChannel) {
        await staffChannel.send(`✅ Conversation for **${ticket.anonId}** was closed.`);
      }

      delete data.userToTicket[ticket.userId];
      delete data.anonToUser[ticket.anonId];
      saveData(data);

      await interaction.reply({
        content: `Closed conversation for ${ticket.anonId}.`,
        ephemeral: true
      });
    } catch (err) {
      console.error("Error closing ticket:", err);
      await interaction.reply({
        content: `There was a problem closing ${ticket.anonId}.`,
        ephemeral: true
      });
    }
  }
});

client.login(TOKEN);