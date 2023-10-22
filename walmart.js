import got from "got";
import HTMLParser from "node-html-parser";
import promptSync from "prompt-sync";
const prompt = promptSync();

import { Webhook, MessageBuilder } from "discord-webhook-node";

//https://www.walmart.com/ip/SAMSUNG-65-Class-4K-Crystal-UHD-2160P-LED-Smart-TV-with-HDR-UN65TU7000/933852540
async function Monitors(product) {
    var header = {
        'connection' : 'keep-alive',
        'sec-ch-ua' : `"Not;A Brand";v="99", "Google Chrome";v="97", "Chromium";v="97"`,
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': 1,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36',
        'accept': '*/*',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navcorsigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'empty',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        // 'rtt': 50,      
        // 'ect': '4g', 
        // 'downlink': 10
    }
    const responses = await got(product, {
        headers: header
    });
    if(responses && responses.statusCode == 200) {
        let roots = HTMLParser.parse(responses.body);
        let avaiabilityStock = roots.getElementsByTagName('button')[0].getAttribute('aria-label');
        console.log("hello", avaiabilityStock)
        var parentDOM = roots.querySelector('#__next');
        //let productPrice = roots.querySelector('#__next > div:nth-child(1) > div > div > div > div > section > main > div > div:nth-child(2) > div > div.w_Ao.w_Bn.w_As > div > div > div.slide-sticky-buy-box-up.z-5 > div > div.pt3 > div > div > div.f6.gray.lh-title.mb3.dn.db-m > span > span:nth-child(2)').getAttribute('itemprop')
        //let productPrice = roots.getElementsByTagName('span')[2].getAttribute('itemprop')
        if(avaiabilityStock) {
            // let productImage = roots.getElementsByTagName('img');
            // for(var i = 0; i < productImage.length; i++) {
            //     if(productImage[i].getAttribute('src').charAt(0) !== '1');
            // }
            let name = avaiabilityStock.className;
            //let productFullName = product.substring(product.indexOf('ip/')+3);
            //let productFullName = roots.querySelector('#__next > div:nth-child(1) > div > div > div > div > section > main > div > div:nth-child(2) > div > div.w_Ao.w_Bn.w_As > div > div > div.slide-sticky-buy-box-up.z-5 > div > div:nth-child(1) > section > h1').textContent;
            var productFullName = parentDOM.getElementsByTagName('h1')[0].innerHTML;
           let productImage = roots.querySelector('#__next > div:nth-child(1) > div > div > div > div > section > main > div > div:nth-child(2) > div > div.w_CO.w_DN.w_CW > div > div > section.flex.items-center > div.mr3.ml7.self-center.relative > div.relative > img').getAttribute('src');
        //    let skuNumber = product.substring(product.indexOf('id=') + 3);
        //    console.log("jj" , skuNumber)
        //    let pickUp = roots.querySelector('#__next > div:nth-child(1) > div > div > div > div > section > main > div > div:nth-child(2) > div > div.w_CO.w_DN.w_CS > div > div > div:nth-child(1) > div > div.f6.bw0-xl.b--near-white.ml3.mr3.mid-gray.ml0-m.mr0-m > div > div > div:nth-child(1) > div:nth-child(2) > span').getElementsByTagName('span')[0].innerText;
        //    console.log("pick", pickUp)
        //     let price = roots.querySelector('#__next > div:nth-child(1) > div > div > div > div > section > main > div > div:nth-child(2) > div > div.w_CO.w_DN.w_CS > div > div > div:nth-child(1) > div > div.pt3 > div > div > div.f6.gray.lh-title.mb3.dn.db-m > span').getElementsByTagName('span')[1].innerText;
        //     console.log("price", price)
        //     let itemSold = roots.querySelector('#__next > div:nth-child(1) > div > div > div > div > section > main > div > div:nth-child(2) > div > div.w_CO.w_DN.w_CS > div > div > div:nth-child(1) > div > div.f6.ml0-xl.mid-gray.mt3.bw0-xl.b--near-white.mb3 > div > div:nth-child(1) > div > span > span').innerText;
        //     console.log("SOLD", itemSold)

            if(name) {
                console.log(productFullName + ": OUT");
            } else {
                const hook = new Webhook("https://discordapp.com/api/webhooks/937783596419272714/l4QcvAN0cge-M6K4vvhzhk8Zi7DnciLnnMU71XZKTW5OtQg-gHJgliX1up8qzJMqBfHr");
                const embed = new MessageBuilder()
                    .setAuthor("Walmart Monitor", "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Walmart_Spark.svg/1925px-Walmart_Spark.svg.png")
                    .setColor("$90ee90")
                    .setTimestamp()
                    .setThumbnail(productImage)
                    .addField(productFullName, product, true)
                    .addField('Avaiability', 'In Stock', false)
                    //.addField('SKU', skuNumber, true)
                    //.addField('Location', pickUp)
                    .addField('Price', price)
                    .addField('Sold By', itemSold)
                hook.send(embed);
                console.log(productFullName + ": IN");    
            }
        }
    }

    await new Promise(r => setTimeout(r,8000));
    Monitors(product);
    return false;
}

async function Run() {
    var product = prompt("Enter links to monitor (separate by coma): ");
    var productLinksArr = product.split(',');
    for(var i = 0; i < productLinksArr.length; i++) {
        productLinksArr[i] = productLinksArr[i].trim();

    }
    //productLinksArr = newArray;
    console.log(productLinksArr);

    var monitors = []  //array of promises

    productLinksArr.forEach(link => {
        var p = new Promise((resolve, reject) => {
            resolve(Monitors(link));
        }).catch(err => console.log(err));

        monitors.push(p);
    });

    console.log('Now monitoring ' + productLinksArr.length + ' items');  
    await Promise.allSettled(monitors);
}

Run();