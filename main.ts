// Tiny stack VM for make.fun tiny-stack-vm-01-run-20261122.
// Implements ISA.md v1 exactly: 32-bit wrapping ints, a 256-value data stack,
// a 64-deep call stack, 256 words of memory, a 1M step limit, a 64K output limit.
// One run answers every instance in MAKEFUN_INPUT_DIR into MAKEFUN_OUTPUT_DIR.
//
// Per-step check order (ISA.md): step limit (trap 10) -> pc outside (trap 9) ->
// unknown opcode (trap 5) -> truncated immediate (trap 9) -> stack needs
// (underflow trap 2 first, then overflow trap 3) -> the instruction's own trap
// (div-by-zero 4, memory 6, call depth 7, RET empty 8, output 11) -> effect.
// A trap ends the program at once, keeps the output written so far, and its
// code is the exit code. HALT exits 0; EXIT exits with v AND 255.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(g, inp) {
  const n = g.length;
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const O = new Uint8Array(65536);
  let sp = 0, cp = 0, pc = 0, st = 0, ol = 0, ip = 0;
  const end = (e) => ({ o: O.slice(0, ol), e });
  for (;;) {
    if (st === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = g[pc];
    let im = 0, po = 0, pu = 0;
    switch (op) {
      case 0x00: break;
      case 0x01: im = 1; pu = 1; break;
      case 0x02: im = 4; pu = 1; break;
      case 0x03: po = 1; break;
      case 0x04: po = 1; pu = 2; break;
      case 0x05: po = 2; pu = 2; break;
      case 0x06: po = 2; pu = 3; break;
      case 0x07: po = 3; pu = 3; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22:
        po = 2; pu = 1; break;
      case 0x17: case 0x1b: po = 1; pu = 1; break;
      case 0x30: im = 2; break;
      case 0x31: case 0x32: im = 2; po = 1; break;
      case 0x33: im = 2; break;
      case 0x34: break;
      case 0x40: po = 1; pu = 1; break;
      case 0x41: po = 2; break;
      case 0x50: case 0x51: case 0x53: po = 1; break;
      case 0x52: pu = 1; break;
      default: return end(5);
    }
    if (pc + im >= n) return end(9);
    st++;
    const nx = pc + 1 + im;
    if (sp < po) return end(2);
    if (sp - po + pu > 256) return end(3);
    pc = nx;
    switch (op) {
      case 0x00: return end(0);
      case 0x01: D[sp++] = (g[nx - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = g[nx - 4] | (g[nx - 3] << 8) | (g[nx - 2] << 16) | (g[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return end(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14:
            if (b === 0) return end(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15:
            if (b === 0) return end(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return end(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((g[nx - 2] | (g[nx - 1] << 8)) << 16) >> 16;
        if (op === 0x30) { pc = nx + rel; break; }
        const v = D[--sp];
        // JZ jumps when v is 0, JNZ when v is not 0; the target is the
        // address of the next instruction plus the signed offset.
        if (op === 0x31 ? v === 0 : v !== 0) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return end(7);
        C[cp++] = nx;
        pc = g[nx - 2] | (g[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return end(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= 256) return end(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (ol + s.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < s.length; i++) O[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        O[ol++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return end(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.o);
  writeFileSync(join(O, id, 'exit.txt'), r.e + '\n');
}
