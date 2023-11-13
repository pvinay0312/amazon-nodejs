import got from "got";
import HTMLParser from "node-html-parser";
import promptSync from "prompt-sync";
const prompt = promptSync();
import puppeteer from 'puppeteer';
import EventEmitter from "events";
import fs from 'fs';
import moment from 'moment';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cron from 'node-cron';
import util from 'util'; // Import the 'util' module

import path from 'path'; // Import the 'path' module
import delay from 'delay';

import { Webhook, MessageBuilder } from "discord-webhook-node";

import express from "express";
import bodyParser from "body-parser";
import { productLinks, lastNotificationTimes, notificationCooldown } from "./productURL.js"

import { pipeline } from 'stream';
import { promisify } from 'util';
import zlib from 'zlib';
import stream, { Readable } from 'stream';
const pipelineAsync = promisify(pipeline);

// New app using express module
const app = express();
app.use(bodyParser.urlencoded({
  extended: true
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logFileName = 'script.log';

// Use 'path' module for log directory
const logDirectory = path.join(__dirname, 'logs');

// Create the log directory if it doesn't exist
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

// Create a log file stream (append mode)
const logStream = fs.createWriteStream(path.join(logDirectory, logFileName), { flags: 'a' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000; // Delay in milliseconds

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36',
  //You can add more user agents
];

export async function Monitor(productLink) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      var myHeaders = {
        'connection': 'keep-alive',
        'sec-ch-ua': `"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"`,
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': 1,
        'user-agent': userAgents,
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
                const hook = new Webhook('https://discord.com/api/webhooks/1165364956817002576/RIvWdsPAZ-fjuxIKPIG07emeznYuCHKLb0LW4pfdmtg5vc5H-n0RCh6jBZ-wdbuOundF');
                const embed = new MessageBuilder()
                  .setAuthor('Amazon Monitor', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png')
                  .setColor('#90ee90')
                  .setTimestamp()
                  .setThumbnail(landingImageElement?.getAttribute('src'))
                  .addField(productName || 'Product Name Not Found', productLink, true)
                  .addField('Availability', 'IN STOCK', false)
                  .addField('SKU', sku || 'SKU Not Found', true)
                  //.addField('Offer ID', availabilityDiv)
                  .addField('Price', price)
                  .addField('Saving Percentage', savings)
                  .addField('LastTimeStemp', currentTime);

                await hook.send(embed);
                console.log(productName + ': IN STOCK');

                console.log('Notification sent', productLinks);
                // Update the last notification time to the current time
                lastNotificationTimes[productLinks] = currentTime;
                console.log("last notification", lastNotificationTimes);
                console.log("checking here", lastNotificationTimes[productLinks] = currentTime);
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

console.log = function() {
  process.stdout.write(util.format.apply(null, arguments) + '\n');
  logStream.write(util.format.apply(null, arguments) + '\n');
}

console.error = function() {
  process.stderr.write(util.format.apply(null, arguments) + '\n');
  logStream.write(util.format.apply(null, arguments) + '\n');
}


// Defining the log direcotry and llog file
const currentDate = moment().format('YYYY-MM-DD');
const logFile = path.join(logDirectory, `script-${currentDate}.log`);