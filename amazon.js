import got from "got";
import HTMLParser from "node-html-parser";
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cron from 'node-cron';
import util from 'util';
import path from 'path';
import delay from 'delay';
import zlib from 'zlib';
import { Readable } from 'stream';

import { Webhook, MessageBuilder } from "discord-webhook-node";

import { productLinks, lastNotificationTimes, notificationCooldown } from "./productURL.js"

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logFileName = 'script.log';

const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

const logStream = fs.createWriteStream(path.join(logDirectory, logFileName), { flags: 'a' });

// Override console before anything else so all logs are captured
console.log = function() {
  process.stdout.write(util.format.apply(null, arguments) + '\n');
  logStream.write(util.format.apply(null, arguments) + '\n');
};

console.error = function() {
  process.stderr.write(util.format.apply(null, arguments) + '\n');
  logStream.write(util.format.apply(null, arguments) + '\n');
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

// Set AMAZON_WEBHOOK_URL in your .env file — never hardcode tokens
const DISCORD_WEBHOOK_URL = process.env.AMAZON_WEBHOOK_URL;
if (!DISCORD_WEBHOOK_URL) throw new Error('Missing env var: AMAZON_WEBHOOK_URL');

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36',
  // Add more user agents as needed
];

export async function Monitor(productLink) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      var myHeaders = {
        'connection': 'keep-alive',
        'sec-ch-ua': `"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"`,
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': 1,
        'user-agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        'Sec-Ch-Ua-Platform': `"macOS"`,
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        'rtt': 200,
        'ect': '4g',
        'downlink': 10
      }
      let response = await got(productLink, { headers: myHeaders, decompress: false });

      if (response.headers['content-encoding'] === 'gzip') {
        const gzip = zlib.createGunzip();
        const decompressedStream = new Readable.from([Buffer.from(response.body, "binary")]);
        const result = [];
        for await (const chunk of decompressedStream.pipe(gzip)) {
          result.push(chunk);
        }
        response.body = Buffer.concat(result).toString();
      } else if (response.headers['content-encoding'] === 'deflate') {
        const deflate = zlib.createInflate();
        const decompressedStream = new Readable.from([Buffer.from(response.body, "binary")]);
        const result = [];
        for await (const chunk of decompressedStream.pipe(deflate)) {
          result.push(chunk);
        }
        response.body = Buffer.concat(result).toString();
      } else {
        response.body = response.body.toString();
      }

      try {
        if (response && response.statusCode === 200) {
          const root = HTMLParser.parse(response.body);

          // Extract availability information
          const offerListingElement = root.querySelector('#offerListingID');
          const availabilityDiv = offerListingElement?.getAttribute('value');

          // Extract SKU information
          const asinElement = root.querySelector('#ASIN');
          const sku = asinElement?.getAttribute('value');

          // Extract product image URL and name
          const landingImageElement = root.querySelector('#landingImage');
          const titleElement = root.querySelector('#productTitle');
          let productName;
          if (titleElement) {
            if (titleElement.firstChild.nodeType == 3) {  // checking whether first child node is Text node
              productName = titleElement.firstChild.text.trim();
            } else {
              productName = titleElement?.querySelector('span')?.innerText;
            }
          }

          // Log product information
          console.log('Availability Div:', availabilityDiv);
          console.log('SKU:', sku);
          console.log('Product Image URL:', landingImageElement?.getAttribute('src'));
          console.log('Product Name:', productName);

          // Check availability
          if (availabilityDiv === '') {
            console.log('OUT OF STOCK');
          } else {
            // Extract product price
            const priceElement = root.querySelector('.a-price .a-offscreen');
            // Extract Saving Percentage
            const savingsPercentage = root.querySelector('.a-size-large.a-color-price.savingPriceOverride.aok-align-center.reinventPriceSavingsPercentageMargin.savingsPercentage');
            if (priceElement && savingsPercentage) {
              const price = priceElement.innerText;
              const savings = savingsPercentage.textContent;
              console.log('Price:', price);
              console.log('Savings Percentage:', savings);

              const currentTime = Date.now();
              const lastNotificationTime = lastNotificationTimes[productLink] || 0;
              if (currentTime - lastNotificationTime >= notificationCooldown) {
                console.log("checking time", notificationCooldown);
                const hook = new Webhook(DISCORD_WEBHOOK_URL);
                const embed = new MessageBuilder()
                  .setAuthor('Amazon Monitor', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png')
                  .setColor('#90ee90')
                  .setTimestamp()
                  .setThumbnail(landingImageElement?.getAttribute('src'))
                  .addField(productName || 'Product Name Not Found', productLink, true)
                  .addField('Availability', 'IN STOCK', false)
                  .addField('SKU', sku || 'SKU Not Found', true)
                  .addField('Price', price)
                  .addField('Saving Percentage', savings);

                await hook.send(embed);
                console.log(productName + ': IN STOCK');

                // Update the last notification time for this specific product link
                lastNotificationTimes[productLink] = currentTime;
                console.log('Notification sent for:', productLink);
              }
            }
          }
        } else {
          console.log('Invalid response');
        }
      } catch (error) {
        console.error('Error while scraping:', error);
      }
      break; // if successful, break the loop

    } catch (error) {
      if (error.response && error.response.statusCode === 503 && attempt < MAX_RETRIES - 1) {
        await wait(RETRY_DELAY);
      } else {
        throw error; // if error is not 503 or retries exceeded, throw error
      }
    }
  }
}

// Start monitoring for all product links
// const monitorPromises = productLinks.map(link => Monitor(link));
// console.log('Monitoring', productLinks.map(link => Monitor(link)));

export async function monitorProductURLs() {
  const monitorPromises = productLinks.map(async (productLink) => {
    console.log('Monitor link', productLink);
    await Monitor(productLink);
    await delay(50000); // Adding a delay of 50 seconds
  });

  await Promise.all(monitorPromises);
  console.log('Monitoring');
}

try {
  cron.schedule('0 * * * *', async () => {
    console.log('Monitoring started');
    try {
      await monitorProductURLs();
    } catch (error) {
      console.error('Error during monitoring:', error);
    }
    console.log('Monitoring completed');
  }, {
    scheduled: true,
    timezone: 'America/New_York'
  });
} catch (error) {
  console.error('Cron job scheduling error:', error);
}

