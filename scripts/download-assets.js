#!/usr/bin/env node
// scripts/download-assets.js
// Downloads all BHB character assets from the CDN into renderer/assets/characters/
// Run automatically during CI build before electron-builder packages the app.
// Safe to re-run — skips files that already exist (for local dev caching).

'use strict';

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const { URL }  = require('url');

const BASE_URL  = 'https://bhaleyart.github.io/BigHeadCharacterCooker';
const OUT_DIR   = path.join(__dirname, '..', 'renderer', 'assets', 'characters');
const CONCURRENCY = 8;   // parallel downloads
const RETRY_MAX   = 3;

// ── Full asset manifest ───────────────────────────────────────────
// Built from TRAITS + FEMALE_LAYERS + SUBSET_EYES in the source code.

const MANIFEST = [
  // ── EYES ───────────────────────────────────────────────────────
  'EYES/Curious.png','EYES/Alien.png','EYES/Annoyed.png','EYES/Demonic.png',
  'EYES/Diamond.png','EYES/Dots.png','EYES/Grumpy.png','EYES/Hypnotized.png',
  'EYES/Infuriated.png','EYES/Insect.png','EYES/Joy.png','EYES/Light Bright.png',
  'EYES/Monocle.png','EYES/Ouchy.png','EYES/Paranoid.png','EYES/Possessed.png',
  'EYES/Ruby Stare.png','EYES/Spider.png','EYES/Stare.png','EYES/Stoney Eyes.png',
  'EYES/Sunglasses.png','EYES/Surprised.png','EYES/Tears.png','EYES/Deceased.png',
  'EYES/Too Chill.png','EYES/VR Headset.png','EYES/3D Glasses.png','EYES/Blink.png',
  'EYES/Stern.png','EYES/Tears.gif',

  // ── EYES/SUBSET ─────────────────────────────────────────────────
  'EYES/SUBSET/alien.png','EYES/SUBSET/alien-blink.png','EYES/SUBSET/alien-ouchy.png',
  'EYES/SUBSET/alien-infuriated.png','EYES/SUBSET/alien-surprised.png',
  'EYES/SUBSET/alien-stern.png','EYES/SUBSET/alien-joy.png','EYES/SUBSET/alien-curious.png',

  'EYES/SUBSET/sunglasses.png','EYES/SUBSET/sunglasses-blink.png','EYES/SUBSET/sunglasses-ouchy.png',
  'EYES/SUBSET/sunglasses-infuriated.png','EYES/SUBSET/sunglasses-surprised.png',
  'EYES/SUBSET/sunglasses-stern.png','EYES/SUBSET/sunglasses-joy.png','EYES/SUBSET/sunglasses-curious.png',

  'EYES/SUBSET/3dglasses.png','EYES/SUBSET/3dglasses-blink.png','EYES/SUBSET/3dglasses-ouchy.png',
  'EYES/SUBSET/3dglasses-infuriated.png','EYES/SUBSET/3dglasses-surprised.png',
  'EYES/SUBSET/3dglasses-stern.png','EYES/SUBSET/3dglasses-joy.png','EYES/SUBSET/3dglasses-curious.png',

  'EYES/SUBSET/spider.png','EYES/SUBSET/spider-blink.png','EYES/SUBSET/spider-ouchy.png',
  'EYES/SUBSET/spider-infuriated.png','EYES/SUBSET/spider-surprised.png',
  'EYES/SUBSET/spider-stern.png','EYES/SUBSET/spider-joy.png','EYES/SUBSET/spider-curious.png',

  'EYES/SUBSET/diamond.png','EYES/SUBSET/diamond-blink.png','EYES/SUBSET/diamond-ouchy.png',
  'EYES/SUBSET/diamond-infuriated.png','EYES/SUBSET/diamond-surprised.png',
  'EYES/SUBSET/diamond-stern.png','EYES/SUBSET/diamond-joy.png','EYES/SUBSET/diamond-curious.png',

  'EYES/SUBSET/ruby.png','EYES/SUBSET/ruby-blink.png','EYES/SUBSET/ruby-ouchy.png',
  'EYES/SUBSET/ruby-infuriated.png','EYES/SUBSET/ruby-surprised.png',
  'EYES/SUBSET/ruby-stern.png','EYES/SUBSET/ruby-joy.png','EYES/SUBSET/ruby-curious.png',

  'EYES/SUBSET/hypnotized.png','EYES/SUBSET/hypnotized-blink.png','EYES/SUBSET/hypnotized-ouchy.png',
  'EYES/SUBSET/hypnotized-infuriated.png','EYES/SUBSET/hypnotized-surprised.png',
  'EYES/SUBSET/hypnotized-stern.png','EYES/SUBSET/hypnotized-joy.png','EYES/SUBSET/hypnotized-curious.png',

  'EYES/SUBSET/monocle.png','EYES/SUBSET/monocle-blink.png','EYES/SUBSET/monocle-ouchy.png',
  'EYES/SUBSET/monocle-infuriated.png','EYES/SUBSET/monocle-surprised.png',
  'EYES/SUBSET/monocle-stern.png','EYES/SUBSET/monocle-joy.png','EYES/SUBSET/monocle-curious.png',

  'EYES/SUBSET/demonic.png','EYES/SUBSET/demonic-blink.png','EYES/SUBSET/demonic-ouchy.png',
  'EYES/SUBSET/demonic-infuriated.png','EYES/SUBSET/demonic-surprised.png',
  'EYES/SUBSET/demonic-stern.png','EYES/SUBSET/demonic-joy.png','EYES/SUBSET/demonic-curious.png',

  'EYES/SUBSET/lightbright.png','EYES/SUBSET/lightbright-blink.png','EYES/SUBSET/lightbright-ouchy.png',
  'EYES/SUBSET/lightbright-infuriated.png','EYES/SUBSET/lightbright-surprised.png',
  'EYES/SUBSET/lightbright-stern.png','EYES/SUBSET/lightbright-joy.png','EYES/SUBSET/lightbright-curious.png',

  'EYES/SUBSET/possesed.png','EYES/SUBSET/possesed-blink.png','EYES/SUBSET/possesed-ouchy.png',
  'EYES/SUBSET/possesed-infuriated.png','EYES/SUBSET/possesed-surprised.png',
  'EYES/SUBSET/possesed-stern.png','EYES/SUBSET/possesed-joy.png','EYES/SUBSET/possesed-curious.png',

  'EYES/SUBSET/dots.png','EYES/SUBSET/dots-blink.png','EYES/SUBSET/dots-ouchy.png',
  'EYES/SUBSET/dots-infuriated.png','EYES/SUBSET/dots-surprised.png',
  'EYES/SUBSET/dots-stern.png','EYES/SUBSET/dots-joy.png','EYES/SUBSET/dots-curious.png',

  'EYES/SUBSET/stoneyeyes.png','EYES/SUBSET/stoneyeyes-blink.png','EYES/SUBSET/stoneyeyes-ouchy.png',
  'EYES/SUBSET/stoneyeyes-infuriated.png','EYES/SUBSET/stoneyeyes-surprised.png',
  'EYES/SUBSET/stoneyeyes-stern.png','EYES/SUBSET/stoneyeyes-joy.png','EYES/SUBSET/stoneyeyes-curious.png',

  'EYES/SUBSET/annoyed.png','EYES/SUBSET/annoyed-blink.png',
  'EYES/SUBSET/grumpy.png','EYES/SUBSET/grumpy-ouchy.png',
  'EYES/SUBSET/paranoid.png','EYES/SUBSET/paranoid-ouchy.png',
  'EYES/SUBSET/insect.png','EYES/SUBSET/insect-ouchy.png',
  'EYES/SUBSET/deceased.png','EYES/SUBSET/deceased-blink.png','EYES/SUBSET/deceased-ouchy.png',
  'EYES/SUBSET/toochill.png','EYES/SUBSET/toochill-blink.png',
  'EYES/SUBSET/vrheadset.png',

  // ── MOUTH ──────────────────────────────────────────────────────
  'MOUTH/Mmm.png','MOUTH/Simpleton.png','MOUTH/Stache.png','MOUTH/Creeper.png',
  'MOUTH/Pierced.png','MOUTH/Fangs.png','MOUTH/Gold Teeth.png','MOUTH/Diamond Teeth.png',
  'MOUTH/CandyGrill.png','MOUTH/Birdy.png','MOUTH/Panic.png','MOUTH/Sss.png',
  'MOUTH/Ahh.png','MOUTH/Ehh.png','MOUTH/Uhh.png','MOUTH/LLL.png','MOUTH/Rrr.png',
  'MOUTH/Fff.png','MOUTH/Ooo.png','MOUTH/Thh.png','MOUTH/Eee.png','MOUTH/Haha.png',
  'MOUTH/Rofl.png','MOUTH/Bean Frown.png','MOUTH/Bean Smile.png','MOUTH/Smirk.png',
  'MOUTH/Bored.png','MOUTH/Gas Mask.png','MOUTH/Scuba.png','MOUTH/Quacked.png',

  // ── HEAD ───────────────────────────────────────────────────────
  'HEAD/None.png','HEAD/Antenna.png','HEAD/Bandana Bro.png','HEAD/Beanie.png',
  'HEAD/Blonde Beanie.png','HEAD/Blonde Bun.png','HEAD/Blue Bedhead.png',
  'HEAD/Brain Squid.png','HEAD/Bravo.png','HEAD/Brunette Beanie.png',
  'HEAD/Brunette Ponytail.png','HEAD/Burger Crown.png','HEAD/Captain Hat.png',
  'HEAD/Mullet.png','HEAD/Cat Hat.png','HEAD/Chad Bandana.png','HEAD/Cherry Sundae.png',
  'HEAD/Clown Wig.png','HEAD/Fancy Hat.png','HEAD/Fireman.png','HEAD/Flame Princess.png',
  'HEAD/Fossilized.png','HEAD/Gamer Girl.png','HEAD/Ginger Ponytail.png','HEAD/Kpop.png',
  'HEAD/Yagami.png','HEAD/Raven.png','HEAD/Heated.png','HEAD/Inferno.png',
  'HEAD/Horny Horns.png','HEAD/Hunted.png','HEAD/Jester.png','HEAD/Kingly.png',
  'HEAD/Mad Hatter.png','HEAD/Masked Up.png','HEAD/Mohawk Blue.png','HEAD/Mohawk Green.png',
  'HEAD/Mohawk Red.png','HEAD/Mortricia.png','HEAD/Outlaw.png','HEAD/Overload.png',
  'HEAD/Patrol Cap.png','HEAD/Pharaoh Hat.png','HEAD/Pink Pigtails.png',
  'HEAD/Powdered Wig.png','HEAD/Press Pass.png','HEAD/Propeller.png',
  'HEAD/Rainbow Babe.png','HEAD/Recon Helmet.png','HEAD/Robin Hood.png',
  'HEAD/Santa Hat.png','HEAD/Sewer Slime.png','HEAD/Snapback Blue.png',
  'HEAD/Snapback Hippy.png','HEAD/Snapback Red.png','HEAD/Snapback Yellow.png',
  'HEAD/Sombrero.png','HEAD/Spiritual.png','HEAD/Surgeon.png','HEAD/UwU Kitty.png',
  'HEAD/Valhalla Cap.png','HEAD/Way Dizzy.png','HEAD/FoxFamous.png',
  'HEAD/Unplugged.png','HEAD/Party-Animal.png',
  'HEAD/Eggcellent+EXP.png','HEAD/Kakarot+EXP.png','HEAD/Martian+EXP.png',
  'HEAD/Pirated+EXP.png','HEAD/Spartan+EXP.png','HEAD/Straw Hat+EXP.png',

  // ── OUTFIT ─────────────────────────────────────────────────────
  'OUTFIT/None.png','OUTFIT/Blue Tee.png','OUTFIT/Blueberry Dye.png',
  'OUTFIT/Degen Green.png','OUTFIT/Degen Purple.png','OUTFIT/Earthy Dye.png',
  'OUTFIT/Hodl Black.png','OUTFIT/Hodl White.png','OUTFIT/Locked Up.png',
  'OUTFIT/Moto-X.png','OUTFIT/Orange Zip.png','OUTFIT/Passion Dye.png',
  'OUTFIT/Pink Zip.png','OUTFIT/Raider Ref.png','OUTFIT/Red Tee.png',
  'OUTFIT/Smally Bigs.png','OUTFIT/Yellow Tee.png','OUTFIT/Blue Zip.png',
  'OUTFIT/Red Zip.png','OUTFIT/White Zip.png','OUTFIT/Hornet Zip.png',
  'OUTFIT/Ghostly Zip.png','OUTFIT/Gold Jacket.png','OUTFIT/Tuxedo.png',
  'OUTFIT/Thrashed.png','OUTFIT/The Fuzz.png','OUTFIT/Pin Striped.png',
  'OUTFIT/Designer Zip.png','OUTFIT/Luxury Zip.png','OUTFIT/Explorer.png',
  'OUTFIT/Power Armor.png','OUTFIT/Shinobi.png','OUTFIT/Thrilled.png',
  'OUTFIT/Trenches.png','OUTFIT/Ski Jacket.png','OUTFIT/Sled Jacket.png',
  'OUTFIT/Commando.png','OUTFIT/Space Cadet.png','OUTFIT/Burgler.png',
  'OUTFIT/Commandant.png','OUTFIT/Golden Knight.png','OUTFIT/Honey Bee.png',
  'OUTFIT/Necromancer.png','OUTFIT/Paladin.png','OUTFIT/Refined Suit.png',
  'OUTFIT/Sexy Jacket.png','OUTFIT/Stoner Hoodie.png','OUTFIT/The Duke.png',
  'OUTFIT/Rave Hoodie.png','OUTFIT/Scuba suit temp.png','OUTFIT/Burger Suit.png',
  'OUTFIT/Scrubs.png','OUTFIT/FlaredUp.png','OUTFIT/Shiller.png',
  'OUTFIT/MetalFan.png','OUTFIT/BH-Tshirt.png','OUTFIT/Uni-Fyed.png',
  'OUTFIT/SuperFlare.png','OUTFIT/BoigaRed.png',
  'OUTFIT/Assassing+EXP.png','OUTFIT/BioHazard+EXP.png','OUTFIT/Box Robot+EXP.png',
  'OUTFIT/CyberSuit+EXP.png','OUTFIT/DickGrayson+EXP.png','OUTFIT/Elm Street+EXP.png',
  'OUTFIT/Funny Biz+EXP.png','OUTFIT/High Mage+EXP.png','OUTFIT/Kringle+EXP.png',
  'OUTFIT/Miles Morales+EXP.png','OUTFIT/Punk Jacket+EXP.png','OUTFIT/Recycled+EXP.png',
  'OUTFIT/Scorpion+EXP.png','OUTFIT/Space Invader+EXP.png',

  // ── TEXTURE ────────────────────────────────────────────────────
  'TEXTURE/None.png','TEXTURE/Blood.png','TEXTURE/Acid.png','TEXTURE/Ink.png',
  'TEXTURE/Dart Frog Blue.png','TEXTURE/Dart Frog Red.png','TEXTURE/Dart Frog Yellow.png',
  'TEXTURE/Magical.png','TEXTURE/Puzzled.png','TEXTURE/Rug Life Ink.png',
  'TEXTURE/Pulverized.png','TEXTURE/FlaredInk.png',
  'TEXTURE/Aura+EXP.png','TEXTURE/Mystic Ink+EXP.png','TEXTURE/Octo Ink+EXP.png',
  'TEXTURE/Saga Ink-EXP.png','TEXTURE/Yakuza+EXP.png',

  // ── BODY ───────────────────────────────────────────────────────
  'BODY/Blank.png','BODY/Charcoal.png','BODY/High Voltage.png','BODY/Nebulous.png',
  'BODY/Pinky.png','BODY/Shockwave.png','BODY/Tangerine.png','BODY/Turquoise.png',
  'BODY/Woody.png','BODY/Frogger.png','BODY/Area 51.png','BODY/Dark Tone.png',
  'BODY/Mid Tone.png','BODY/Light Tone.png','BODY/Jolly Roger.png',
  'BODY/Cyber Punk.png','BODY/Talking Corpse.png','BODY/Day Tripper.png',
  'BODY/Meat Lover.png','BODY/Golden God.png','BODY/Chrome Dome.png',
  'BODY/Candy Gloss.png','BODY/Man On Fire.png','BODY/Water Boy.png',
  'BODY/Icecream Man.png','BODY/Reptilian.png','BODY/Juiced Up.png',
  'BODY/Toxic Waste.png','BODY/Love Potion.png','BODY/Pop Artist.png',
  'BODY/Autopsy.png','BODY/Ghostly.png','BODY/Blue Screen.png',
  'BODY/Networker.png','BODY/IceMan.png','BODY/TheLizard.png',
  'BODY/Primal.png','BODY/PanduBeru.png',

  // ── BACKGROUNDS ────────────────────────────────────────────────
  'BACKGROUNDS/None.png','BACKGROUNDS/Natural.png','BACKGROUNDS/Mania.png',
  'BACKGROUNDS/Regal.png','BACKGROUNDS/Lavish.png','BACKGROUNDS/Sunflower.png',
  'BACKGROUNDS/Snowflake.png','BACKGROUNDS/Bleach.png','BACKGROUNDS/Vibes.png',
  'BACKGROUNDS/Burst.png','BACKGROUNDS/Aquatic.png','BACKGROUNDS/Passionate.png',
  'BACKGROUNDS/Envious.png','BACKGROUNDS/Enlightened.png','BACKGROUNDS/Haunted.png',
  'BACKGROUNDS/Cursed.png','BACKGROUNDS/SolFlare.png','BACKGROUNDS/Tangerine.png',
  'BACKGROUNDS/Navy.png','BACKGROUNDS/Crimson.png','BACKGROUNDS/Graphite.png',
  'BACKGROUNDS/Eggshell.png','BACKGROUNDS/Slate.png','BACKGROUNDS/Kuwai.png',
  'BACKGROUNDS/Velvet.png','BACKGROUNDS/Money.png','BACKGROUNDS/Sky.png',

  // ── GIRL (female layers) ───────────────────────────────────────
  'GIRL/Eyelashes.png','GIRL/Breasts.png',

  // ── SCENES (88 background images) ─────────────────────────────
  'SCENES/bg1.png',
  'SCENES/bg2.png',
  'SCENES/bg3.png',
  'SCENES/bg4.png',
  'SCENES/bg5.png',
  'SCENES/bg6.png',
  'SCENES/bg7.png',
  'SCENES/bg8.png',
  'SCENES/bg9.png',
  'SCENES/bg10.png',
  'SCENES/bg11.png',
  'SCENES/bg12.png',
  'SCENES/bg13.png',
  'SCENES/bg14.png',
  'SCENES/bg15.png',
  'SCENES/bg16.png',
  'SCENES/bg17.png',
  'SCENES/bg18.png',
  'SCENES/bg19.png',
  'SCENES/bg20.png',
  'SCENES/bg21.png',
  'SCENES/bg22.png',
  'SCENES/bg23.png',
  'SCENES/bg24.png',
  'SCENES/bg25.png',
  'SCENES/bg26.png',
  'SCENES/bg27.png',
  'SCENES/bg28.png',
  'SCENES/bg29.png',
  'SCENES/bg30.png',
  'SCENES/bg31.png',
  'SCENES/bg32.png',
  'SCENES/bg33.png',
  'SCENES/bg34.png',
  'SCENES/bg35.png',
  'SCENES/bg36.png',
  'SCENES/bg37.png',
  'SCENES/bg38.png',
  'SCENES/bg39.png',
  'SCENES/bg40.png',
  'SCENES/bg41.png',
  'SCENES/bg42.png',
  'SCENES/bg43.png',
  'SCENES/bg44.png',
  'SCENES/bg45.png',
  'SCENES/bg46.png',
  'SCENES/bg47.png',
  'SCENES/bg48.png',
  'SCENES/bg49.png',
  'SCENES/bg50.png',
  'SCENES/bg51.png',
  'SCENES/bg52.png',
  'SCENES/bg53.png',
  'SCENES/bg54.png',
  'SCENES/bg55.png',
  'SCENES/bg56.png',
  'SCENES/bg57.png',
  'SCENES/bg58.png',
  'SCENES/bg59.png',
  'SCENES/bg60.png',
  'SCENES/bg61.png',
  'SCENES/bg62.png',
  'SCENES/bg63.png',
  'SCENES/bg64.png',
  'SCENES/bg65.png',
  'SCENES/bg66.png',
  'SCENES/bg67.png',
  'SCENES/bg68.png',
  'SCENES/bg69.png',
  'SCENES/bg70.png',
  'SCENES/bg71.png',
  'SCENES/bg72.png',
  'SCENES/bg73.png',
  'SCENES/bg74.png',
  'SCENES/bg75.png',
  'SCENES/bg76.png',
  'SCENES/bg77.png',
  'SCENES/bg78.png',
  'SCENES/bg79.png',
  'SCENES/bg80.png',
  'SCENES/bg81.png',
  'SCENES/bg82.png',
  'SCENES/bg83.png',
  'SCENES/bg84.png',
  'SCENES/bg85.png',
  'SCENES/bg86.png',
  'SCENES/bg87.png',
  'SCENES/bg88.png',
];

// ── Helpers ──────────────────────────────────────────────────────
function mkdirp(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest, retries = 0) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) { resolve('cached'); return; }

    mkdirp(path.dirname(dest));
    const file = fs.createWriteStream(dest + '.tmp');
    const mod  = url.startsWith('https') ? https : http;

    const req = mod.get(url, { timeout: 30000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(dest + '.tmp', () => {});
        return download(res.headers.location, dest, retries).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest + '.tmp', () => {});
        const err = new Error(`HTTP ${res.statusCode} — ${url}`);
        if (retries < RETRY_MAX) {
          setTimeout(() => download(url, dest, retries + 1).then(resolve).catch(reject), 1000 * (retries + 1));
        } else {
          reject(err);
        }
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(dest + '.tmp', dest);
          resolve('downloaded');
        });
      });
    });

    req.on('error', err => {
      file.close();
      fs.unlink(dest + '.tmp', () => {});
      if (retries < RETRY_MAX) {
        setTimeout(() => download(url, dest, retries + 1).then(resolve).catch(reject), 1000 * (retries + 1));
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => req.destroy());
  });
}

// ── Concurrent queue ─────────────────────────────────────────────
async function runQueue(tasks, concurrency) {
  let idx = 0, done = 0, downloaded = 0, cached = 0, failed = 0;
  const total = tasks.length;

  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      try {
        const result = await task();
        done++;
        if (result === 'downloaded') downloaded++;
        else cached++;
        process.stdout.write(`\r  ${done}/${total}  ↓${downloaded} cached:${cached} err:${failed}   `);
      } catch (e) {
        failed++;
        done++;
        process.stdout.write(`\r  ${done}/${total}  ↓${downloaded} cached:${cached} err:${failed}   `);
        // Non-fatal — some EXP assets may 404 if not on CDN yet
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write('\n');
  return { downloaded, cached, failed };
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🍔 BHB Asset Downloader`);
  console.log(`   Source : ${BASE_URL}`);
  console.log(`   Output : ${OUT_DIR}`);
  console.log(`   Assets : ${MANIFEST.length} files\n`);

  mkdirp(OUT_DIR);

  const tasks = MANIFEST.map(assetPath => () => {
    const url  = `${BASE_URL}/${assetPath.split('/').map(encodeURIComponent).join('/')}`;
    const dest = path.join(OUT_DIR, ...assetPath.split('/'));
    return download(url, dest);
  });

  const { downloaded, cached, failed } = await runQueue(tasks, CONCURRENCY);

  console.log(`\n✅ Done — ${downloaded} downloaded, ${cached} already cached, ${failed} failed\n`);

  if (failed > MANIFEST.length * 0.1) {
    console.error('ERROR: Too many failures — check network connectivity');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
