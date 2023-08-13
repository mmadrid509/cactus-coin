const config = require("./config.json");
const Discord = require("discord.js");
const rest = new Discord.REST({
	version: '10'
}).setToken(config.discord.token);
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const client = new Discord.Client({
	intents: [
		"GuildMembers",
		"Guilds"
	]
});


// Use sqlite3 for object storage, and create a database if it doesn't exist
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.db");

// Create table if it doesn't exist
db.run("CREATE TABLE IF NOT EXISTS points (id TEXT, points INTEGER)");
// update table if it does exist

client.on("ready", async () => {
	console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`)
	// Load Commands
	console.log(`${colors.cyan("[INFO]")} Loading Commands...`)
	const commands = require('./commands.json');
	await (async () => {
		try {
			console.log(`${colors.cyan("[INFO]")} Registering Commands...`)
			let start = Date.now()
			// Global commands
			await rest.put(Discord.Routes.applicationCommands(client.user.id), {
				body: commands
			});

			console.log(`${colors.cyan("[INFO]")} Successfully registered commands. Took ${colors.green((Date.now() - start) / 1000)} seconds.`);
		} catch (error) {
			console.error(error);
		}
	})();


	// Log startup time in seconds
	console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green((Date.now() - initTime) / 1000)} seconds.`)
});

// Functions

checkAndModifyPoints = async (user, amount, override) => {
	// Check if the user exists, if not, add them to the database
	await db.get(`SELECT * FROM points WHERE id = '${user.id}'`, async (err, row) => {

		if (err) {
			console.error(`Smthn went wrong: ${err}`);
			return false;
		}
		if (!row) {
			await db.run(`INSERT INTO points (id, points) VALUES ('${user.id}', ${amount})`);
			return amount;
		}
		if (row) {
			if (override) {
				await db.run(`UPDATE points SET points = ${amount} WHERE id = '${user.id}'`);
				return amount;
			}
			await db.run(`UPDATE points SET points = ${row.points + amount} WHERE id = '${user.id}'`);
			return row.points + amount;
		}
		return false;
	});
}

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	switch (interaction.commandName) {
		case "points":
			var user;
			if (interaction.options.getMember("user")) {
				user = interaction.options.getMember("user").user;
			} else {
				user = interaction.user;
			}
			// Get user data
			await db.get(`SELECT * FROM points WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
				}
				if (!row) return interaction.reply({
					content: "This user does not have any coins.",
					ephemeral: true
				});
				if (row) {
					var data = row;
					interaction.reply({
						embeds: [{
							title: `${user.username}'s Coins`,
							description: `${config.discord.coin}${data.points}`,
						}]
					});
				}
			});
			break;
		case "leaderboard":
			await db.all(`SELECT * FROM points ORDER BY points DESC`, async (err, rows) => {
				if (err) {
					console.error(err);
				}
				if (!rows) return interaction.reply({
					content: "It's quiet here...",
					ephemeral: true
				});
				if (rows) {
					let leaderboard = [];
					// Top 10
					for (let i = 0; i < 10; i++) {
						if (rows[i]) {
							let user = await client.users.fetch(rows[i].id);
							let lvl = rows[i].lvl;
							leaderboard.push(`${i + 1}. <@${user.id}> - ${config.discord.coin}${rows[i].points}`);
						}
					}
					interaction.reply({
						embeds: [{
							title: "Leaderboard",
							description: leaderboard.join("\n"),
							color: 0x00ff00
						}]
					});
				}
			});
			break;

		case "modify":
			// check if the user is in the config.discord.givers array
			if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true
			});
			let outputStatus = await checkAndModifyPoints(interaction.options.getMember("user").user, interaction.options.getNumber("amount"), interaction.options.getBoolean("override") || false);
			if (outputStatus !== false) {
				interaction.reply({
					content: `Gave ${interaction.options.getMember("user").user.username} ${interaction.options.getNumber("amount")} coins.`,
					ephemeral: true
				});
				// add + or - to the amount
				let amount = interaction.options.getNumber("amount");
				if (amount > 0) {
					amount = `+${amount}`;
				} else {
					amount = `-${amount}`;
				}
				// Send the log to the log channel
				// Tell the user their coins were modified
				interaction.options.getMember("user").user.send({
					embeds: [{
						title: "Coins Modified",
						description: `${config.discord.coin}${amount}`,
						color: 0xFFff00
					}]
				}).catch(err => { });


			} else {
				interaction.reply({
					content: `An error occurred.\n`,
					ephemeral: true
				});
			}
			break;
		case "transfer": // Allows a user to transfer a positive amount of coins to another user at a 50% tax, rounded down, if the user sends 2 coins, the other user will receive 1, the other gets sent to the abyss.
			// check if the arguments are there
			if (!interaction.options.getMember("user")) return interaction.reply({
				content: "You must specify a user.",
				ephemeral: true
			});
			if (!interaction.options.getNumber("amount")) return interaction.reply({
				content: "You must specify an amount.",
				ephemeral: true
			});
			// Sanity check to make sure they arent trying to send negative coins and break the economy
			if (interaction.options.getNumber("amount") < 0) return interaction.reply({
				content: "You cannot send negative coins you lil goober.",
				ephemeral: true
			});

			// Round the input up (these fuckers found a dupe one fucking day into the bot, fuck you krill issue)
			let amount = Math.ceil(interaction.options.getNumber("amount"));


			// check if the user has enough coins
			await db.get(`SELECT * FROM points WHERE id = '${interaction.user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
					return interaction.reply({
						content: "An error occurred.",
						ephemeral: true
					});
				}
				if (!row) return interaction.reply({
					content: "You do not have any coins.",
					ephemeral: true
				});
				if (row) {
					if (row.points < amount) return interaction.reply({
						content: "You do not have enough coins.",
						ephemeral: true
					});
					// If the user doesnt have any coins tell them.
					if (row.points == 0) return interaction.reply({
						content: "You do not have any coins.",
						ephemeral: true
					});
					// Now check if they have enough for the tax
					if (row.points < Math.floor(amount * 2)) return interaction.reply({
						content: "You do not have enough coins to pay the tax.",
						ephemeral: true
					});
					// At this point we know they have enough coins, so we can take them away, make sure to take the tax away too
					checkAndModifyPoints(interaction.user, -Math.floor(amount * 2));
					// Now we can give the other user the coins
					checkAndModifyPoints(interaction.options.getMember("user").user, amount);
					// Now we can tell the user that it worked
					interaction.reply({
						embeds: [{
							title: "Transfer Successful",
							color: 0x00ff00,
							description: `You sent ${config.discord.coin}${amount} to ${interaction.options.getMember("user").user.username}.`
						}]
					});
					// Tell the user being transferred from about the change as a sort of receipt
					interaction.options.getMember("user").user.send({
						embeds: [{
							title: "Transfer Receipt",
							color: 0xffff00,
							description: `You received ${config.discord.coin}${amount} from ${interaction.user}.`
						}]
					}).catch(err => { });;
					interaction.user.send({
						embeds: [{
							title: "Transfer Receipt",
							color: 0xffff00,
							description: `You sent ${config.discord.coin}${amount} to ${interaction.options.getMember("user").user}.\nYou paid a tax of ${config.discord.coin}${amount}.`
						}]
					}).catch(err => { });

				}
			});
			break;
		case "ledger": // Allows a user to see the balance of every user in the database
			db.all(`SELECT * FROM points`, async (err, rows) => {
				if (err) {
					console.error(err);
					return interaction.reply({
						content: "An error occurred.",
						ephemeral: true
					});
				}
				if (!rows) return interaction.reply({
					content: "It's quiet here...",
					ephemeral: true
				});
				if (rows) {
					let ledger = [];
					for (let i = 0; i < rows.length; i++) {
						let user = await client.users.fetch(rows[i].id);
						if (rows[i].points == 0) continue;
						ledger.push(`${user.username} - ${rows[i].points}`);
					}
					interaction.reply({
						embeds: [{
							title: "Ledger",
							description: ledger.join("\n"),
							color: 0x00ff00
						}]
					});
				}
			});
			break;
		case "play": // Allows a user to play a game to earn coins (or lose them)
			if (gameCooldowns[interaction.user.id]) {
				if (gameCooldowns[interaction.user.id][interaction.options.getString("game")]) {
					let timesPlayed = gameCooldowns[interaction.user.id][interaction.options.getString("game")].timesPlayed;
					let unlock = gameCooldowns[interaction.user.id][interaction.options.getString("game")].unlock;
					if (timesPlayed >= config.games.gamesPerPeriod) {
						if (unlock < Date.now()) {
							delete gameCooldowns[interaction.user.id][interaction.options.getString("game")];
						} else {
							return interaction.reply({
								content: `You can play again in <t:${Math.floor(unlock / 1000)}:R>.`,
								ephemeral: true
							});
						}
					}
				}
			}
			// Check if they're in debt, if they are dont let them play
			await db.get(`SELECT * FROM points WHERE id = '${interaction.user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
					return interaction.reply({
						content: "An error occurred.",
						ephemeral: true
					});
				}

				if (row && row.points < 0) return interaction.reply({
					content: "You are in debt, you cannot play games until you pay it off.",
					ephemeral: true
				});
			});
			let result = await playGame(interaction.options.getString("game"));
			await checkAndModifyPoints(interaction.user, result.difference);
			if (!gameCooldowns[interaction.user.id]) gameCooldowns[interaction.user.id] = {};
			if (!gameCooldowns[interaction.user.id][interaction.options.getString("game")]) {
				gameCooldowns[interaction.user.id][interaction.options.getString("game")] = {
					timesPlayed: 1,
					unlock: Date.now() + (config.games.waitPeriod * 60 * 1000)
				};
			} else {
				let timesPlayed = gameCooldowns[interaction.user.id][interaction.options.getString("game")].timesPlayed;
				// Add the cooldown from config.games.waitPeriod
				gameCooldowns[interaction.user.id][interaction.options.getString("game")] = {
					timesPlayed: timesPlayed + 1,
					unlock: Date.now() + (config.games.waitPeriod * 60 * 1000)
				};
			}

			interaction.reply(result.string);
			break;
	};
});

// Game function
function playGame(gameName) {
	const randomNumber = Math.random() * 100;
	let result = {
		string: "",
		difference: 0
	};

	switch (gameName) {
		case 'FISHING':
			if (randomNumber < 40) {
				result.string = "You caught water! Congrats?";
			} else if (randomNumber < 70) {
				result.string = "You caught a fish! That's pretty cool I guess. (+1 coin)";
				result.difference = 1;
			} else if (randomNumber < 90) {
				result.string = "You caught a fish but BIGGER! Neat! (+2 coins)";
				result.difference = 2;
			} else if (randomNumber < 95) {
				result.string = "You caught a WORM with your worm! Cactus likes worms! (+3 coins)";
				result.difference = 3;
			} else {
				result.string = "You caught a piranha. It didn't appreciate that and mugged you at gunpoint. (-3 coins)";
				result.difference = -3;
			}
			break;

		case 'DIGGING':
			if (randomNumber < 40) {
				result.string = "You dug up dirt! Bleh! That sure is boring.";
			} else if (randomNumber < 70) {
				result.string = "You dug up a shiny pebble! That's pretty rad. (+1 coin)";
				result.difference = 1;
			} else if (randomNumber < 90) {
				result.string = "You dug up a stick. Sticks are sticky! Nice! (+2 coins)";
				result.difference = 2;
			} else if (randomNumber < 95) {
				result.string = "You dug up a sick ass earthworm! Cactus likes worms, let me tell you. (+3 coins)";
				result.difference = 3;
			} else {
				result.string = "You hit an electrical wire digging. That was one crazy shock! Melted the coins you had on you! (-3 coins)";
				result.difference = -3;
			}
			break;

		case 'HUNTING':
			if (randomNumber < 40) {
				result.string = "You came back empty handed like a loser. Nice job.";
			} else if (randomNumber < 70) {
				result.string = "You killed a rabbit. That's pretty cool I guess, you can make a jump boost from it. (+1 coin)";
				result.difference = 1;
			} else if (randomNumber < 90) {
				result.string = "You killed a deer! Nice shooting! (+2 coins)";
				result.difference = 2;
			} else if (randomNumber < 95) {
				result.string = "You killed a Bigfoot. Wait.... What? You killed a bigfo- The government pays to keep you quiet. (+3 coins.)";
				result.difference = 3;
			} else {
				result.string = "You were trying to shoot a deer, missed, and hit Carl. They fined you for the hospital bills. (-3 coins)";
				result.difference = -3;
			}
			break;

		default:
			result.string = "Unknown game";
			break;
	}

	return result;
}

var gameCooldowns = {};

// Handle SIGINT gracefully
process.on('SIGINT', async () => {
	await console.log(`${colors.cyan("[INFO]")} Stop received, exiting...`);
	await client.user.setPresence({
		status: "invisible",
		activities: []
	});
	await client.destroy();
	await console.log(`${colors.cyan("[INFO]")} Goodbye!`);
	process.exit(0);
});

// Global error handler
/*process.on('uncaughtException', async (error) => {
	await console.error(`${colors.red("[ERROR]")} Uncaught Exception: ${error}`);
	if (client.user.tag) {
		client.channels.fetch(config.discord.errorChannel).then(async channel => {
			await channel.send({
				embeds: [{
					title: "Uncaught Exception",
					description: `\`\`\`${error}\`\`\``,
					color: 0xff0000
				}]
			});
		});
	}
});*/



console.log(`${colors.cyan("[INFO]")} Starting...`)
// Start timer to see how long startup takes
const initTime = Date.now()
// Login to Discord
client.login(config.discord.token);