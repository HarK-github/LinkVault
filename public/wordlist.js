/**
 * LinkVault Wormhole - Human-Friendly Word Lists
 *
 * Why Word Lists?
 * Instead of asking users to type a 64-character hex hash or scan a QR code,
 * Wormhole generates friendly passphrases like "swift-42-river".
 *
 * Math & Entropy:
 * - 128 distinct adjectives
 * - 100 numbers (0 to 99)
 * - 128 distinct nouns
 * Total combinations: 128 * 100 * 128 = 1,638,400 possible passphrases.
 * Each word is single-syllable or very easy to speak out loud or type on a phone.
 */

const WH_ADJ = [
  "amber", "arctic", "ashen", "azure", "beige", "birch", "black", "blaze",
  "bleak", "bliss", "blown", "blue", "bold", "brave", "brief", "brisk",
  "broad", "bronze", "brown", "calm", "cedar", "chill", "clean", "clear",
  "cold", "cool", "coral", "crisp", "cross", "cyan", "damp", "dark",
  "dawn", "deep", "dense", "dim", "dull", "dusk", "dusty", "eager",
  "early", "east", "ember", "empty", "even", "fair", "fast", "fierce",
  "fine", "fixed", "flame", "flat", "fleet", "fresh", "frozen", "full",
  "giant", "gold", "grand", "grave", "gray", "great", "green", "grim",
  "hard", "harsh", "heavy", "high", "hollow", "hot", "huge", "icy",
  "jade", "keen", "kind", "large", "last", "late", "lean", "light",
  "loud", "low", "mild", "mint", "misty", "neat", "night", "north",
  "old", "olive", "open", "pale", "pink", "plain", "prime", "pure",
  "quick", "quiet", "rare", "raw", "red", "rich", "rigid", "rose",
  "rough", "round", "royal", "ruby", "rust", "safe", "sandy", "sharp",
  "short", "shy", "silk", "silver", "slim", "slow", "small", "smart",
  "smooth", "soft", "solid", "south", "spare", "stark", "still", "stone",
  "storm", "swift", "tall", "thin", "tight", "tiny", "tough", "true",
  "vast", "warm", "west", "wide", "wild", "wise", "worn", "young"
];

const WH_NOUN = [
  "ant", "apple", "arch", "ark", "arrow", "ash", "atlas", "atom",
  "bark", "barn", "base", "bay", "beam", "bear", "bell", "bird",
  "blade", "boat", "bone", "book", "boot", "branch", "brick", "bridge",
  "brook", "brush", "bull", "bush", "cage", "camp", "canal", "cape",
  "cave", "chalk", "chip", "cliff", "cloud", "coil", "coin", "cord",
  "core", "crane", "creek", "crop", "crown", "cube", "curve", "dawn",
  "deck", "den", "desk", "disk", "dome", "door", "dove", "draft",
  "drain", "dune", "dust", "echo", "edge", "elm", "farm", "fern",
  "field", "fish", "flag", "flame", "flash", "fleet", "flint", "flow",
  "foam", "fog", "fold", "font", "forge", "fork", "frost", "gate",
  "gem", "glade", "globe", "glow", "grain", "grove", "gulf", "haze",
  "heap", "hill", "hive", "horn", "hull", "jar", "jet", "key",
  "kite", "knot", "lake", "lamp", "lance", "lark", "leaf", "ledge",
  "link", "lock", "loft", "loop", "map", "marsh", "mask", "maze",
  "mist", "moon", "moss", "mount", "nail", "nest", "node", "oak",
  "orb", "park", "path", "peak", "pine", "pipe", "plank", "plate",
  "pond", "port", "post", "rail", "rain", "reef", "ring", "river",
  "rock", "rope", "root", "rune", "rust", "sage", "sand", "shaft",
  "shell", "ship", "shore", "silk", "slab", "slate", "smoke", "snow",
  "soil", "spark", "spring", "star", "stem", "stone", "storm", "stream"
];

// Attach to browser global scope
if (typeof window !== 'undefined') {
  window.WH_ADJ = WH_ADJ;
  window.WH_NOUN = WH_NOUN;
}

// Export for Node.js / testing environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WH_ADJ, WH_NOUN };
}
