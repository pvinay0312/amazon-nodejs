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

// Minimum savings % needed to trigger a notification when there's no coupon
const MIN_SAVINGS_PCT = 15;

// Set AMAZON_WEBHOOK_URL in your .env file — never hardcode tokens
const DISCORD_WEBHOOK_URL = process.env.AMAZON_WEBHOOK_URL;
if (!DISCORD_WEBHOOK_URL) throw new Error('Missing env var: AMAZON_WEBHOOK_URL');

// Separate cooldowns: coupon alerts (30 min) vs deal/stock alerts (1 hour)
const couponNotificationCooldown = 30 * 60 * 1000;
const lastCouponNotificationTimes = {};

// --- Price history: persist last known price per ASIN to detect drops across runs ---
const priceHistoryFile = path.join(logDirectory, 'price_history.json');

function loadPriceHistory() {
  try {
    return JSON.parse(fs.readFileSync(priceHistoryFile, 'utf8'));
  } catch {
    return {};
  }
}

function savePriceHistory(history) {
  fs.writeFileSync(priceHistoryFile, JSON.stringify(history, null, 2));
}

// --- Stock status: track whether each ASIN was in/out of stock last check ---
// When a product flips from out-of-stock → in-stock we fire an instant restock alert,
// bypassing the deal filter and cooldown entirely.
const stockStatusFile = path.join(logDirectory, 'stock_status.json');

function loadStockStatus() {
  try {
    return JSON.parse(fs.readFileSync(stockStatusFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveStockStatus(status) {
  fs.writeFileSync(stockStatusFile, JSON.stringify(status, null, 2));
}

// Parse "$29.99" or "29.99" → 29.99, returns null if unparseable
function parsePrice(priceStr) {
  if (!priceStr || priceStr === 'N/A') return null;
  const match = priceStr.replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

// Parse "-15%" or "15% off" → 15, returns null if unparseable
function parseSavingsPct(savingsStr) {
  if (!savingsStr) return null;
  const match = savingsStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Extracts clean coupon text from a DOM element.
// Amazon sometimes embeds <style> blocks inside coupon elements — textContent
// pulls everything including raw CSS, so we strip it before returning.
function extractCouponText(el) {
  if (!el) return null;
  const cleaned = el.toString()
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 5 || cleaned.includes('{') || cleaned.includes('!important')) return null;
  return cleaned;
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36',
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

          // Detect CAPTCHA / bot-check page
          const pageTitle = root.querySelector('title')?.text || '';
          if (pageTitle.includes('Robot Check') || pageTitle.includes('CAPTCHA') || pageTitle.includes('Sorry')) {
            console.log(`CAPTCHA detected for: ${productLink} — skipping`);
            break;
          }

          // --- SKU / ASIN ---
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
            isAvailable = offerListingEl.getAttribute('value') !== '';
          } else if (availabilityText) {
            isAvailable = availabilityText.includes('in stock') || availabilityText.includes('available');
          } else {
            isAvailable = !!addToCartBtn;
          }

          // --- Limited stock detection ---
          const availabilityFullText = root.querySelector('#availability')?.textContent?.trim() || '';
          const limitedStockMatch    = availabilityFullText.match(/only\s+(\d+)\s+left/i);
          const stockCount           = limitedStockMatch ? parseInt(limitedStockMatch[1]) : null;
          const isLimitedStock       = stockCount !== null && stockCount <= 10;

          // --- Restock detection ---
          // We require a product to be OOS for 2+ consecutive cycles before treating
          // it as "truly OOS". This prevents false restock alerts caused by a single
          // failed scrape (CAPTCHA, network blip) that incorrectly recorded OOS.
          const stockStatus   = loadStockStatus();
          const prev          = stockStatus[sku] || { status: 'unknown', oosCount: 0 };
          const wasDefinitelyOOS = prev.status === 'out_of_stock' && prev.oosCount >= 2;

          if (isAvailable) {
            stockStatus[sku] = { status: 'in_stock', oosCount: 0 };
          } else {
            stockStatus[sku] = { status: 'out_of_stock', oosCount: (prev.oosCount || 0) + 1 };
          }
          saveStockStatus(stockStatus);

          if (!isAvailable) {
            const streak = stockStatus[sku].oosCount;
            console.log(`${productName}: OUT OF STOCK (${streak} consecutive cycle${streak !== 1 ? 's' : ''})`);
          } else {
            // --- Current price (extracted first so restock embed can include it) ---
            const price = root.querySelector('#corePrice_feature_div .a-offscreen')?.innerText?.trim()
                       || root.querySelector('.a-price .a-offscreen')?.innerText?.trim()
                       || root.querySelector('#price_inside_buybox')?.innerText?.trim()
                       || root.querySelector('#priceblock_ourprice')?.innerText?.trim()
                       || root.querySelector('#priceblock_dealprice')?.innerText?.trim()
                       || root.querySelector('.a-price-whole')?.textContent?.trim()
                       || 'N/A';

            // --- Back in stock alert (fires immediately, no deal filter, no cooldown) ---
            // Only fires when the product was confirmed OOS for 2+ cycles, then came back.
            if (wasDefinitelyOOS) {
              console.log(`${productName} [${sku}]: BACK IN STOCK after ${prev.oosCount} OOS cycles — sending restock alert`);
              try {
                const hook  = new Webhook(DISCORD_WEBHOOK_URL);
                const embed = new MessageBuilder()
                  .setAuthor('Amazon Restock Alert 🔔', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png')
                  .setColor('#00FF7F')
                  .setTitle(`🔔 Back in Stock! — ${productName}`)
                  .setURL(productLink)
                  .setTimestamp()
                  .setThumbnail(productImage)
                  .addField('✅ Status', 'Back in Stock', true)
                  .addField('💰 Price', price, true)
                  .addField('📦 ASIN', sku, true)
                  .addField('🔗 Buy Now', productLink, false);
                await hook.send(embed);
              } catch (err) {
                console.error('Restock alert failed:', err.message);
              }
            }

            // --- Original / list price (for "reg $X" display) ---
            // Use only strikethrough-specific selectors to avoid grabbing the current price again.
            // Then discard if it parses to the same value as the current price.
            const originalPriceRaw = root.querySelector('.basisPrice .a-offscreen')?.innerText?.trim()
                                  || root.querySelector('#listPrice')?.innerText?.trim()
                                  || root.querySelector('#priceblock_was_price')?.innerText?.trim()
                                  || root.querySelector('.a-price[data-a-strike="true"] .a-offscreen')?.innerText?.trim()
                                  || null;
            const originalPrice = (originalPriceRaw && parsePrice(originalPriceRaw) !== parsePrice(price))
                                  ? originalPriceRaw
                                  : null;

            // --- Savings % shown by Amazon on deal pages ---
            // Strip leading minus and normalise to "31% off" format
            const savingsRaw  = root.querySelector('.savingPriceOverride.savingsPercentage')?.textContent?.trim()
                             || root.querySelector('#savingsPercentage')?.textContent?.trim()
                             || null;
            const savingsText = savingsRaw ? savingsRaw.replace(/^-/, '') + ' off' : null;
            const savingsPct  = parseSavingsPct(savingsText);

            // --- Lightning Deal detection ---
            const isLightningDeal = !!(
              root.querySelector('#dealBadge') ||
              root.querySelector('#dealBadgeSupportingText') ||
              root.querySelector('.dealBadge') ||
              root.querySelector('[id*="deal-badge"]')
            );

            // --- Coupon — wide net of selectors + page-text fallback ---
            // Amazon renders coupon badges server-side but uses many different IDs/classes.
            // If all element selectors miss, scan the full page text for "Apply X% coupon" patterns.
            const coupon = extractCouponText(root.querySelector('#couponText'))
                        || extractCouponText(root.querySelector('#couponBadgeID'))
                        || extractCouponText(root.querySelector('.couponBadgeRegularVpc'))
                        || extractCouponText(root.querySelector('#vpcButton span'))
                        || extractCouponText(root.querySelector('[data-feature-name="couponButton"] span'))
                        || extractCouponText(root.querySelector('[data-feature-name="coupon"] span'))
                        || extractCouponText(root.querySelector('#couponFeatureBadge'))
                        || extractCouponText(root.querySelector('.couponFeature'))
                        || extractCouponText(root.querySelector('[id*="coupon"] span'))
                        || (() => {
                             // Broad fallback: scan page for coupon text patterns
                             const pageText = root.querySelector('#ppd')?.textContent
                                           || root.querySelector('#dp')?.textContent
                                           || '';
                             const m = pageText.match(
                               /(?:apply|clip|save|get)\s+(\$[\d.]+|\d+%)\s+(?:with\s+)?(?:this\s+)?coupon/i
                             ) || pageText.match(
                               /(\d+%\s+off|save\s+\$[\d.]+)\s+with\s+(?:this\s+)?coupon/i
                             );
                             return m ? m[0].replace(/\s+/g, ' ').trim() : null;
                           })()
                        || null;

            // --- Price drop detection via persisted history ---
            const priceHistory  = loadPriceHistory();
            const currentPriceNum = parsePrice(price);
            const lastKnownPrice  = priceHistory[sku] ?? null;
            let priceDrop = null;
            let priceDropPct = null;

            if (currentPriceNum && lastKnownPrice && currentPriceNum < lastKnownPrice) {
              const dropAmt = lastKnownPrice - currentPriceNum;
              priceDropPct  = Math.round((dropAmt / lastKnownPrice) * 100);
              if (priceDropPct >= MIN_SAVINGS_PCT) {
                priceDrop = { from: `$${lastKnownPrice.toFixed(2)}`, to: price, pct: priceDropPct };
              }
            }
            if (currentPriceNum) {
              priceHistory[sku] = currentPriceNum;
              savePriceHistory(priceHistory);
            }

            // --- Is this a real deal worth notifying? ---
            // Only alert when: coupon present, lightning deal, savings >= 15%, price dropped >= 15%,
            // or limited stock alongside any discount (urgency even at lower savings %)
            const effectiveSavingsPct = savingsPct ?? priceDropPct ?? 0;
            const isDeal = coupon
                        || isLightningDeal
                        || effectiveSavingsPct >= MIN_SAVINGS_PCT
                        || (isLimitedStock && effectiveSavingsPct > 0);

            // --- Deal type label and embed color ---
            let dealLabel, embedColor;
            if (isLightningDeal) {
              dealLabel  = '⚡ Lightning Deal';
              embedColor = '#FF4500';
            } else if (coupon && isLimitedStock) {
              dealLabel  = '🎟️🔥 Coupon + Low Stock';
              embedColor = '#FF0000'; // red — urgent
            } else if (coupon) {
              dealLabel  = '🎟️ Coupon Deal';
              embedColor = '#FFD700';
            } else if (priceDrop) {
              dealLabel  = '📉 Price Drop';
              embedColor = '#1E90FF';
            } else if (isLimitedStock && effectiveSavingsPct > 0) {
              dealLabel  = '⚠️ Low Stock Deal';
              embedColor = '#FFA500';
            } else if (effectiveSavingsPct >= MIN_SAVINGS_PCT) {
              dealLabel  = '🔥 Big Discount';
              embedColor = '#FF6347';
            } else {
              dealLabel  = null;
              embedColor = '#90ee90';
            }

            const logLine = `${productName} [${sku}]: IN STOCK${isLimitedStock ? ` (only ${stockCount} left!)` : ''} | ${price}`
              + (originalPrice   ? ` (reg ${originalPrice})` : '')
              + (savingsText     ? ` | ${savingsText}`       : '')
              + (coupon          ? ` | Coupon: ${coupon}`    : '')
              + (isLightningDeal ? ` | LIGHTNING DEAL`       : '');
            console.log(logLine);

            if (!isDeal) {
              console.log(`  → No deal (full price), skipping notification`);
            } else {
              const currentTime     = Date.now();
              const lastStockNotif  = lastNotificationTimes[productLink] || 0;
              const lastCouponNotif = lastCouponNotificationTimes[productLink] || 0;

              const stockCooldownPassed  = currentTime - lastStockNotif  >= notificationCooldown;
              const couponCooldownPassed = currentTime - lastCouponNotif >= couponNotificationCooldown;
              // Limited stock always bypasses cooldown — subscribers must know before it's gone
              const shouldNotify = isLimitedStock || (coupon ? couponCooldownPassed : stockCooldownPassed);

              if (shouldNotify) {
                // Title styled like: "🔥 73% OFF! Sony WH-1000XM5 Headphones"
                const pctLabel   = effectiveSavingsPct > 0 ? `${effectiveSavingsPct}% OFF! ` : '';
                const regLabel   = originalPrice ? ` (reg ${originalPrice})` : '';
                const embedTitle = dealLabel
                  ? `${dealLabel} — ${pctLabel}${productName}`
                  : productName;
                const priceDisplay = `${price}${regLabel}`;

                const hook  = new Webhook(DISCORD_WEBHOOK_URL);
                const embed = new MessageBuilder()
                  .setAuthor('Amazon Deal Alert 🛒', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png')
                  .setColor(embedColor)
                  .setTitle(embedTitle)
                  .setURL(productLink)
                  .setTimestamp()
                  .setThumbnail(productImage)
                  .addField('💰 Price', priceDisplay, true)
                  .addField('📦 ASIN', sku, true);

                if (isLimitedStock)               embed.addField('🚨 Stock Warning', `Only **${stockCount}** left — act fast!`, false);
                if (priceDrop)                    embed.addField('📉 Price Drop', `~~${priceDrop.from}~~ → **${priceDrop.to}** (${priceDrop.pct}% off)`, false);
                if (savingsText && !priceDrop)    embed.addField('💸 Savings', savingsText, true);
                if (coupon)                       embed.addField('🎟️ Use Code at Checkout', `\`${coupon}\``, false);
                if (isLightningDeal)              embed.addField('⚡ Lightning Deal', 'Limited time — act fast!', false);

                embed.addField('🔗 Buy Now', productLink, false);

                await hook.send(embed);

                if (coupon && couponCooldownPassed)  lastCouponNotificationTimes[productLink] = currentTime;
                if (!coupon && stockCooldownPassed)  lastNotificationTimes[productLink]       = currentTime;

                console.log(`  → Notification sent [${dealLabel || 'deal'}]: ${productLink}`);
              } else {
                console.log(`  → Deal found but cooldown active, skipping`);
              }
            }
          }
        } else {
          console.log('Invalid response for:', productLink);
        }
      } catch (error) {
        console.error('Error while scraping:', error);
      }
      break; // success — exit retry loop

    } catch (error) {
      if (error.response && error.response.statusCode === 503 && attempt < MAX_RETRIES - 1) {
        await wait(RETRY_DELAY);
      } else {
        throw error;
      }
    }
  }
}

export async function monitorProductURLs() {
  const monitorPromises = productLinks.map(async (productLink) => {
    console.log('Monitor link', productLink);
    await Monitor(productLink);
    await delay(3000); // 3 seconds between products
  });

  await Promise.all(monitorPromises);
  console.log('Monitoring cycle complete');
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
