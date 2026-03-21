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

// Separate cooldown for coupon alerts (30 min) vs stock alerts (1 hour)
// This ensures a new coupon triggers a notification even if stock was recently alerted
const couponNotificationCooldown = 30 * 60 * 1000;
const lastCouponNotificationTimes = {};

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

          // Detect CAPTCHA / bot-check page — Amazon sometimes returns these instead of the product
          const pageTitle = root.querySelector('title')?.text || '';
          if (pageTitle.includes('Robot Check') || pageTitle.includes('CAPTCHA') || pageTitle.includes('Sorry')) {
            console.log(`CAPTCHA detected for: ${productLink} — skipping`);
            break;
          }

          // --- SKU / ASIN ---
          // Fallback: extract ASIN directly from the URL (always works)
          const asinFromUrl = productLink.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null;
          const sku = root.querySelector('#ASIN')?.getAttribute('value')
                   || root.querySelector('[data-asin]')?.getAttribute('data-asin')
                   || asinFromUrl
                   || 'N/A';

          // --- Product image ---
          const productImage = root.querySelector('#landingImage')?.getAttribute('src')
                            || root.querySelector('#imgTagWrapperId img')?.getAttribute('src')
                            || root.querySelector('#main-image-container img')?.getAttribute('src')
                            || root.querySelector('.a-dynamic-image')?.getAttribute('src')
                            || '';

          // --- Product name ---
          const titleEl = root.querySelector('#productTitle');
          const productName = titleEl?.firstChild?.text?.trim()
                           || titleEl?.querySelector('span')?.innerText?.trim()
                           || root.querySelector('#title_feature_div h1 span')?.innerText?.trim()
                           || root.querySelector('h1.a-size-large span')?.textContent?.trim()
                           || 'Product Name Not Found';

          // --- Availability — three fallback methods ---
          const offerListingEl   = root.querySelector('#offerListingID');
          const availabilityText = root.querySelector('#availability span')?.textContent?.trim()?.toLowerCase() || '';
          const addToCartBtn     = root.querySelector('#add-to-cart-button');

          let isAvailable = false;
          if (offerListingEl) {
            // Empty value = out of stock, non-empty = in stock
            isAvailable = offerListingEl.getAttribute('value') !== '';
          } else if (availabilityText) {
            isAvailable = availabilityText.includes('in stock') || availabilityText.includes('available');
          } else {
            // Last resort: add-to-cart button presence
            isAvailable = !!addToCartBtn;
          }

          if (!isAvailable) {
            console.log(`${productName}: OUT OF STOCK`);
          } else {
            // --- Price — multiple fallbacks ---
            const price = root.querySelector('#corePrice_feature_div .a-offscreen')?.innerText?.trim()
                       || root.querySelector('.a-price .a-offscreen')?.innerText?.trim()
                       || root.querySelector('#price_inside_buybox')?.innerText?.trim()
                       || root.querySelector('#priceblock_ourprice')?.innerText?.trim()
                       || root.querySelector('#priceblock_dealprice')?.innerText?.trim()
                       || root.querySelector('.a-price-whole')?.textContent?.trim()
                       || 'N/A';

            // --- Savings % ---
            const savings = root.querySelector('.savingPriceOverride.savingsPercentage')?.textContent?.trim() || null;

            // --- Coupon — Amazon uses many different elements depending on deal type ---
            const coupon = root.querySelector('#couponText')?.textContent?.trim()
                        || root.querySelector('#couponBadgeID')?.textContent?.trim()
                        || root.querySelector('.couponBadgeRegularVpc')?.textContent?.trim()
                        || root.querySelector('#vpcButton span')?.textContent?.trim()
                        || root.querySelector('[data-feature-name="couponButton"] span')?.textContent?.trim()
                        || root.querySelector('.promoPriceBlockMessage')?.textContent?.trim()
                        || null;

            console.log(`${productName} [${sku}]: IN STOCK | ${price}${savings ? ` | ${savings} off` : ''}${coupon ? ` | Coupon: ${coupon}` : ''}`);

            const currentTime     = Date.now();
            const lastStockNotif  = lastNotificationTimes[productLink] || 0;
            const lastCouponNotif = lastCouponNotificationTimes[productLink] || 0;

            const stockCooldownPassed  = currentTime - lastStockNotif  >= notificationCooldown;
            const couponCooldownPassed = currentTime - lastCouponNotif >= couponNotificationCooldown;
            const shouldNotify = stockCooldownPassed || (coupon && couponCooldownPassed);

            if (shouldNotify) {
              const hook = new Webhook(DISCORD_WEBHOOK_URL);
              const embed = new MessageBuilder()
                .setAuthor('Amazon Monitor', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png')
                .setColor(coupon ? '#FFD700' : '#90ee90')
                .setTimestamp()
                .setThumbnail(productImage)
                .addField(productName, productLink, true)
                .addField('Availability', 'IN STOCK ✅', false)
                .addField('SKU', sku, true)
                .addField('Price', price);

              if (savings) embed.addField('Savings', savings);
              if (coupon)  embed.addField('🎟️ Coupon Code', coupon);

              await hook.send(embed);

              if (stockCooldownPassed)              lastNotificationTimes[productLink]       = currentTime;
              if (coupon && couponCooldownPassed)    lastCouponNotificationTimes[productLink] = currentTime;

              console.log(`Notification sent for: ${productLink}${coupon ? ' [COUPON]' : ''}`);
            }
          }
        } else {
          console.log('Invalid response for:', productLink);
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
    await delay(3000); // 3 seconds between products — polite but fast
  });

  await Promise.all(monitorPromises);
  console.log('Monitoring');
}

try {
  cron.schedule('*/15 * * * *', async () => {
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

