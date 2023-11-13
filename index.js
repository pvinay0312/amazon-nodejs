import pkg from 'discord.js';
//import { CronJob } from 'cron';
//import { productLinks } from './productURL.js';
//import { Monitor, monitorProductURLs } from './amazon.js';
import { monitorProductURLs } from './amazon.js';
import server from './keep_alive.js';

const { Client, Intents } = pkg;
const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('error', console.error); // Log Discord client errors
client.on('warn', console.warn); // Log warnings

// In your original CronJob setup block:
// try {
//   console.log('CronJob initialization started');
//   const monitorPromises = productLinks.map(link => Monitor(link));
//   console.log("checking promise")
//   const job = new CronJob('* * * * *', async function() {
//     console.log('Monitoring started');

//     try {
//       for (const productLink of productLinks) {
//         await Monitor(productLink);
//         console.log('Monitoring products');
//       }
//       await Promise.all(monitorPromises);
//       console.log('Monitoring completed');
//     } catch (error) {
//       console.error('Error during monitoring:', error);
//     }

//   }, null, true, 'America/New_York');

//   console.log('CronJob initialization completed');

//   // Manually fire the CronJob once immediately after initialization
//   job.fireOnTick();

// } catch (error) {
//   console.error('Cron job scheduling error:', error);
// }

monitorProductURLs()

server();

client.login(process.env['TOKEN']);
