// Self-contained, zero-dependency QR code SVG generator for browser
// Supports byte mode (URLs, plain text), error correction level M

(function(root) {
  const PAD0 = 0xec, PAD1 = 0x11;

  const QRRSBlock = [
    // 1-L, 1-M
    [1, 26, 19], [1, 26, 16],
    // 2-L, 2-M
    [1, 44, 34], [1, 44, 28],
    // 3-L, 3-M
    [1, 70, 55], [1, 70, 44],
    // 4-L, 4-M
    [1, 100, 80], [2, 50, 32],
    // 5-L, 5-M
    [1, 134, 108], [2, 67, 43],
    // 6-L, 6-M
    [2, 86, 68], [4, 43, 27]
  ];

  const EXP_TABLE = new Uint8Array(256);
  const LOG_TABLE = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }

  function polyMul(p1, p2) {
    const res = new Uint8Array(p1.length + p2.length - 1);
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        res[i + j] ^= EXP_TABLE[(LOG_TABLE[p1[i]] + LOG_TABLE[p2[j]]) % 255];
      }
    }
    return res;
  }

  function polyMod(dividend, divisor) {
    let result = new Uint8Array(dividend);
    while (result.length >= divisor.length) {
      if (result[0] !== 0) {
        const factor = LOG_TABLE[result[0]];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= EXP_TABLE[(LOG_TABLE[divisor[i]] + factor) % 255];
        }
      }
      result = result.slice(1);
    }
    return result;
  }

  function getGenerator(ecCount) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < ecCount; i++) {
      poly = polyMul(poly, new Uint8Array([1, EXP_TABLE[i]]));
    }
    return poly;
  }

  function BitBuffer() {
    this.buffer = [];
    this.length = 0;
  }
  BitBuffer.prototype = {
    put: function(num, length) {
      for (let i = 0; i < length; i++) {
        this.putBit(((num >>> (length - i - 1)) & 1) === 1);
      }
    },
    putBit: function(bit) {
      const bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    }
  };

  function createQRCode(text) {
    const bytes = new TextEncoder().encode(text);
    // Find version (1 to 6)
    let version = 1;
    let totalDataBytes = 0;
    let ecBytesPerBlock = 0;
    let numBlocks = 1;

    for (let v = 1; v <= 6; v++) {
      const blockInfo = QRRSBlock[(v - 1) * 2 + 1]; // Level M
      numBlocks = blockInfo[0];
      const totalBytes = blockInfo[1] * numBlocks;
      totalDataBytes = blockInfo[2] * numBlocks;
      ecBytesPerBlock = blockInfo[1] - blockInfo[2];
      if (bytes.length + 3 <= totalDataBytes) { // Mode (4b) + Length (8/16b)
        version = v;
        break;
      }
    }

    const bb = new BitBuffer();
    bb.put(4, 4); // 8-bit byte mode
    bb.put(bytes.length, version < 10 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    // Terminator
    while (bb.length % 8 !== 0) bb.putBit(false);
    while (bb.buffer.length < totalDataBytes) {
      bb.buffer.push(PAD0);
      if (bb.buffer.length < totalDataBytes) bb.buffer.push(PAD1);
    }

    // Error correction
    const gen = getGenerator(ecBytesPerBlock);
    const dataBlocks = [];
    const ecBlocks = [];
    const dataPerBlock = totalDataBytes / numBlocks;

    for (let b = 0; b < numBlocks; b++) {
      const dataBlock = bb.buffer.slice(b * dataPerBlock, (b + 1) * dataPerBlock);
      dataBlocks.push(dataBlock);
      const toEncode = new Uint8Array(dataBlock.length + ecBytesPerBlock);
      toEncode.set(dataBlock);
      const ec = polyMod(toEncode, gen);
      ecBlocks.push(ec);
    }

    // Interleave
    const interleaved = [];
    for (let i = 0; i < dataPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) interleaved.push(dataBlocks[b][i]);
    }
    for (let i = 0; i < ecBytesPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) interleaved.push(ecBlocks[b][i]);
    }

    const size = version * 4 + 17;
    const matrix = Array.from({ length: size }, () => Array(size).fill(null));

    // Place finder patterns
    function placeFinder(r, c) {
      for (let i = -1; i <= 7; i++) {
        for (let j = -1; j <= 7; j++) {
          const row = r + i, col = c + j;
          if (row < 0 || row >= size || col < 0 || col >= size) continue;
          if ((i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
              (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
              (i >= 2 && i <= 4 && j >= 2 && j <= 4)) {
            matrix[row][col] = 1;
          } else {
            matrix[row][col] = 0;
          }
        }
      }
    }
    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    // Place alignment patterns for version >= 2
    if (version >= 2) {
      const pos = [6, version * 4 + 10];
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          const r = pos[i], c = pos[j];
          if (matrix[r][c] !== null) continue;
          for (let di = -2; di <= 2; di++) {
            for (let dj = -2; dj <= 2; dj++) {
              matrix[r + di][c + dj] = (Math.max(Math.abs(di), Math.abs(dj)) !== 1) ? 1 : 0;
            }
          }
        }
      }
    }

    // Timing lines
    for (let i = 8; i < size - 8; i++) {
      if (matrix[6][i] === null) matrix[6][i] = (i % 2 === 0) ? 1 : 0;
      if (matrix[i][6] === null) matrix[i][6] = (i % 2 === 0) ? 1 : 0;
    }

    // Format info reserve
    for (let i = 0; i < 9; i++) {
      if (matrix[8][i] === null) matrix[8][i] = 0;
      if (matrix[i][8] === null) matrix[i][8] = 0;
      if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = 0;
      if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = 0;
    }
    matrix[size - 8][8] = 1; // dark module

    // Data placement
    let bitIdx = 0;
    const totalBits = interleaved.length * 8;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right--;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const col = right - j;
          const up = ((right + 1) & 2) === 0;
          const row = up ? (size - 1 - vert) : vert;
          if (matrix[row][col] === null) {
            let bit = false;
            if (bitIdx < totalBits) {
              const byteVal = interleaved[Math.floor(bitIdx / 8)];
              bit = ((byteVal >>> (7 - (bitIdx % 8))) & 1) === 1;
              bitIdx++;
            }
            // Mask pattern 0: (row + col) % 2 === 0
            const mask = ((row + col) % 2 === 0);
            matrix[row][col] = (bit ^ mask) ? 1 : 0;
          }
        }
      }
    }

    // Format information (Mask 0, Level M: 0x5412)
    const formatInfo = 0x5412;
    for (let i = 0; i < 15; i++) {
      const bit = ((formatInfo >>> (14 - i)) & 1);
      if (i < 6) matrix[8][i] = bit;
      else if (i < 8) matrix[8][i + 1] = bit;
      else matrix[14 - i][8] = bit;

      if (i < 8) matrix[size - 1 - i][8] = bit;
      else matrix[8][size - 15 + i] = bit;
    }

    return matrix;
  }

  function generateSvg(text, margin = 2) {
    const matrix = createQRCode(text);
    const size = matrix.length;
    const total = size + margin * 2;
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c] === 1) {
          path += `M${c + margin},${r + margin}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
  }

  root.LinkVaultQR = { generateSvg };
})(typeof window !== 'undefined' ? window : global);
