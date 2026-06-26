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


// config from env
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_CATEGORY_ID = process.env.STAFF_CATEGORY_ID;

// optional role lock
// leave blank if everyone with channel access can use commands
const STAFF_ROLE_ID = "";


// local ticket storage
const DATA_FILE = path.join(__dirname, "tickets.json");


// load saved tickets
function loadData() {
  let parsed = {};

  if (fs.existsSync(DATA_FILE)) {
    try {
      parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (err) {
      console.error("Could not read tickets.json, starting fresh.");
    }
  }

  // make sure both maps always exist
  return {
    userToTicket: parsed.userToTicket || {},
    anonToUser: parsed.anonToUser || {}
  };
}


// save tickets to file
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const data = loadData();


// make random anonymous id
function makeAnonId() {
  let anonId = "";

  do {
    anonId = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (data.anonToUser[anonId]);

  return anonId;
}


// make anon id safe for channel name
function sanitizeChannelName(anonId) {
  return anonId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}


// check if staff can use command
function hasStaffAccess(interaction) {
  if (!STAFF_ROLE_ID) return true;

  return interaction.member.roles.cache.has(STAFF_ROLE_ID);
}


// find ticket from staff channel
function getTicketByChannelId(channelId) {
  for (const anonId in data.anonToUser) {
    const ticket = data.anonToUser[anonId];

    if (ticket.channelId === channelId) {
      return { anonId, ...ticket };
    }
  }

  return null;
}


// get existing ticket or make a new one
async function getOrCreateTicket(user) {
  // reuse ticket if user already has one open
  if (data.userToTicket[user.id]) {
    return data.userToTicket[user.id];
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  const anonId = makeAnonId();
  const channelName = sanitizeChannelName(anonId);

  // make private staff channel under category
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: STAFF_CATEGORY_ID
  });

  // store ticket info
  const ticket = {
    anonId,
    userId: user.id,
    channelId: channel.id
  };

  // map real user to ticket
  data.userToTicket[user.id] = ticket;

  // map anon id back to user
  data.anonToUser[anonId] = {
    userId: user.id,
    channelId: channel.id
  };

  saveData(data);

  await channel.send(`**${anonId}** opened a new anonymous thread!\n`);

  return ticket;
}


// discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});


// register slash commands
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

  // push commands to server
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered.");
}


// bot startup
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});


// user dm -> staff channel
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // only handle dms to bot
  if (message.channel.type === ChannelType.DM) {
    try {
      const ticket = await getOrCreateTicket(message.author);
      const staffChannel = await client.channels.fetch(ticket.channelId);

      if (!staffChannel) {
        console.error("Staff ticket channel not found.");
        return;
      }

      // get message text
      let content = message.content?.trim();

      if (!content) {
        content = "*[no text message]*";
      }

      // send message to staff
      await staffChannel.send(`📩 **${ticket.anonId}** says:\n${content}`);

      // send attachments too
      if (message.attachments.size > 0) {
        const urls = [...message.attachments.values()].map(file => file.url);

        await staffChannel.send(
          `📎 **${ticket.anonId}** attachment(s):\n${urls.join("\n")}`
        );
      }

      // confirm to user
      await message.channel.send(
        "Thank you for your message to the PE's! We will try to get back to you in 24 hours, and if a response is not given, feel free to DM the bot again with a reminder or any follow-ups :3 We appreciate any and all feedback! Have an awesome day queen <3"
      );
    } catch (err) {
      console.error("Error relaying DM:", err);
    }
  }
});


// staff slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // only allow commands in the server
  if (interaction.guildId !== GUILD_ID) {
    await interaction.reply({
      content: "This command can only be used in the server.",
      ephemeral: true
    });
    return;
  }

  // optional staff role check
  if (!hasStaffAccess(interaction)) {
    await interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true
    });
    return;
  }

  // reply command
  if (interaction.commandName === "reply") {
    const responseMessage = interaction.options.getString("message");
    const ticket = getTicketByChannelId(interaction.channelId);

    // command must be used inside ticket channel
    if (!ticket) {
      await interaction.reply({
        content: "This channel is not linked to an anonymous conversation.",
        ephemeral: true
      });
      return;
    }

    try {
      const user = await client.users.fetch(ticket.userId);

      // send response to anonymous user
      await user.send(`**PE's response to ${ticket.anonId}:**\n${responseMessage}`);

      const staffChannel = await client.channels.fetch(ticket.channelId);

      // log response in staff channel
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

  // close command
  if (interaction.commandName === "close") {
    const ticket = getTicketByChannelId(interaction.channelId);

    // command must be used inside ticket channel
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

      // remove ticket from storage
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


// login bot
client.login(TOKEN);
