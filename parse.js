// Turns a spoken or typed catch note into structured fields, and guesses spot types.
(function (root) {
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3, dozen: 12 };

  // Most specific names first, so "red snapper" is not read as a redfish.
  const SPECIES = [
    ['Red snapper', /\bred snappers?\b/],
    ['Red grouper', /\bred groupers?\b/],
    ['Black drum', /\bblack drums?\b/],
    ['Gag grouper', /\bgag( groupers?)?s?\b/],
    ['Goliath grouper', /\bgoliaths?( groupers?)?\b/],
    ['Grouper', /\bgroupers?\b/],
    ['Mangrove snapper', /\b(mangrove snappers?|mangroves?|mangos?|gray snappers?|grey snappers?)\b/],
    ['Lane snapper', /\blane snappers?\b/],
    ['Vermilion snapper', /\b(vermilion snappers?|beeliners?)\b/],
    ['Redfish', /\b(red ?fish|reds|red drum|bull reds?|slot reds?|red)\b/],
    ['Snook', /\bsnooks?\b/],
    ['Spotted seatrout', /\b(sea ?trout|speckled trout|specks|gator trout|trout)\b/],
    ['Sheepshead', /\bsheeps?heads?\b/],
    ['Cobia', /\bcobias?\b/],
    ['Tarpon', /\btarpons?\b/],
    ['Pompano', /\bpompanos?\b/],
    ['Flounder', /\bflounders?\b/],
    ['Kingfish', /\b(kingfish|king mackerel|kings?)\b/],
    ['Spanish mackerel', /\b(spanish mackerel|spanish|mackerel)\b/],
    ['Amberjack', /\b(amberjacks?|aj|ajs)\b/],
    ['Triggerfish', /\btrigger(fish)?s?\b/],
    ['Jack crevalle', /\b(jack crevalle|jacks?)\b/],
    ['Lionfish', /\blionfish\b/],
    ['Bonnethead shark', /\bbonnetheads?\b/],
    ['Shark', /\bsharks?\b/],
    ['Ladyfish', /\bladyfish\b/],
    ['Whiting', /\bwhitings?\b/],
    ['Mahi', /\b(mahi|dolphin|dorado)\b/],
    ['Hogfish', /\bhogfish\b/],
    ['Porgy', /\bporgys?|porgies\b/],
  ];

  const STOP = '(?:at|near|by|off|around|in|today|this|and|then|caught|got|on|with|using|about|was|were|they|it)';

  function countBefore(text, idx) {
    const words = text.slice(0, idx).trim().split(/\s+/).slice(-3).reverse();
    for (const w of words) {
      const clean = w.replace(/[^a-z0-9]/g, '');
      if (/^\d+$/.test(clean)) return +clean;
      if (NUM[clean] !== undefined) return NUM[clean];
    }
    return 1;
  }

  function parseCatch(raw) {
    const text = ' ' + String(raw || '').toLowerCase().replace(/[“”]/g, '"') + ' ';
    let work = text;
    const fish = [];
    for (const [name, re] of SPECIES) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(work))) {
        if (name === 'Redfish' && m[0].trim() === 'red' && !/\bred\s+(fish|drum)\b/.test(work.slice(m.index, m.index + 12))) {
          // a bare "red" only counts when it stands as the fish name, e.g. "caught a red"
          const before = work.slice(Math.max(0, m.index - 12), m.index);
          if (!/\b(a|one|two|three|four|five|\d+|nice|big|slot|another)\s*$/.test(before)) continue;
        }
        const count = countBefore(work, m.index);
        const found = fish.find(f => f.species === name);
        if (found) found.count += count; else fish.push({ species: name, count });
        work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
        g.lastIndex = m.index + m[0].length;
      }
    }

    const len = text.match(/(\d+(?:\.\d+)?)\s*(?:(?:-|to)\s*(\d+(?:\.\d+)?)\s*)?(?:inches|inch|in\b|")/);
    const wt = text.match(/(\d+(?:\.\d+)?)\s*(?:(?:-|to)\s*(\d+(?:\.\d+)?)\s*)?(?:pounds?|lbs?)\b/);
    const bait = text.match(new RegExp('\\b(?:on|with|using)\\s+(?:a|an|some|the|live|fresh)?\\s*((?:live |fresh |cut |frozen )?[a-z][a-z \\-]{1,28}?)(?=[,.!]|\\s+' + STOP + '\\b|\\s*$)'));
    const spot = text.match(new RegExp('\\b(?:at|near|by|off|around)\\s+(?:the\\s+)?([a-z0-9][a-z0-9 \'\\-]{1,40}?)(?=[,.!]|\\s+' + STOP + '\\b|\\s*$)'));
    let kept = null;
    if (/\b(released|let (it|them|him|her) go|catch and release|threw (it|them) back|tossed (it|them) back)\b/.test(text)) kept = false;
    if (/\b(kept|keeper|keepers|took (it|them) home|in the cooler|for dinner)\b/.test(text)) kept = true;

    const num = s => (s ? +s : null);
    let baitText = bait ? bait[1].trim() : '';
    if (/^(the )?(incoming|outgoing|falling|rising)/.test(baitText)) baitText = '';
    if (SPECIES.some(([, re]) => re.test(baitText)) && !/\b(cut|live|chunk|strip)\b/.test(baitText)) {
      // "caught on a red" is not a bait; keep baits like "cut ladyfish"
      if (!/\b(pinfish|shrimp|crab|pilchard|greenback|mullet|threadfin|sardine)\b/.test(baitText)) baitText = '';
    }
    let spotName = spot ? spot[1].trim() : '';
    if (/\b(pounds?|lbs?|inch|inches|feet|ft|minutes?|hours?)\b/.test(spotName)) spotName = '';
    if (!spotName) {
      // "Anclote flats, caught three reds…" — a short opening phrase names the spot
      const lead = text.match(/^\s*([a-z0-9' \-]{3,40}?)\s*,/);
      if (lead && !SPECIES.some(([, re]) => re.test(lead[1])) && !/\b(caught|got|landed|hooked|just|today|we|i)\b/.test(lead[1])) spotName = lead[1].trim();
    }
    return {
      fish,
      length: len ? num(len[1]) : null,
      lengthMax: len && len[2] ? num(len[2]) : null,
      weight: wt ? num(wt[1]) : null,
      bait: baitText,
      spotName,
      kept,
    };
  }

  const TYPES = [
    ['Wreck', /wreck|barge|sunk|tug|ship|hull/],
    ['Rig / platform', /\brig\b|platform|tower/],
    ['Artificial reef', /reef|artificial|\bar\b|pyramid|module|culvert|rubble/],
    ['Ledge / hard bottom', /ledge|rock|hard ?bottom|hump|break|bottom|live ?bottom|hole/],
    ['Dock / bridge', /dock|pier|bridge|piling|seawall|marina|jetty|trestle|causeway/],
    ['Oyster bed', /oyster|\bbar\b|shell/],
    ['Mangrove line', /mangrove|island|key\b|shoreline/],
    ['Flat', /flat|grass|pothole|sand ?bar/],
    ['River / creek', /river|creek|bayou|canal|mouth|channel/],
  ];
  const SYMS = [
    ['Wreck', /wreck/],
    ['Artificial reef', /reef/],
    ['Dock / bridge', /dock|marina|bridge/],
    ['Rig / platform', /oil|platform/],
  ];

  function guessType(name, sym) {
    const n = String(name || '').toLowerCase();
    const s = String(sym || '').toLowerCase();
    for (const [t, re] of TYPES) if (re.test(n)) return { type: t, how: 'name' };
    for (const [t, re] of SYMS) if (re.test(s)) return { type: t, how: 'icon' };
    return { type: '', how: '' };
  }

  function zoneFromDepth(depthFt) {
    if (depthFt == null) return '';
    if (depthFt < 20) return 'Inshore';
    if (depthFt < 70) return 'Nearshore';
    return 'Offshore';
  }

  function parseGPX(xmlText, DOMParserImpl) {
    const P = DOMParserImpl || root.DOMParser;
    const doc = new P().parseFromString(xmlText, 'application/xml');
    const out = [];
    const nodes = doc.getElementsByTagName('wpt');
    for (let i = 0; i < nodes.length; i++) {
      const w = nodes[i];
      const lat = parseFloat(w.getAttribute('lat'));
      const lon = parseFloat(w.getAttribute('lon'));
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const tag = t => { const e = w.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
      out.push({ lat, lon, name: tag('name') || 'Spot ' + (i + 1), sym: tag('sym'), note: tag('desc') || tag('cmt') });
    }
    return out;
  }

  const api = { parseCatch, guessType, zoneFromDepth, parseGPX, SPECIES };
  if (typeof module !== 'undefined') module.exports = api; else root.RP = api;
})(typeof window !== 'undefined' ? window : globalThis);
