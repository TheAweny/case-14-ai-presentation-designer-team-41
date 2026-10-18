import { BlockList, isIP } from 'node:net';

/**
 * Whether an IP may be contacted as a public web origin.
 * Names are not public until a caller resolves them and checks every answer.
 * The whole IPv4-mapped prefix ::ffff:0:0/96 is refused, including the hex form ::ffff:7f00:1.
 */

const blockedV4 = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}

export function isPublicWebAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  const ip = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (ip === '' || ip.includes('%')) return false;
  if (isIP(ip) === 4) return !blockedV4.check(ip, 'ipv4');
  if (isIP(ip) !== 6) return false;
  const groups = expandIPv6(ip);
  if (groups === null) return false;
  if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) return false;
  const first = groups[0] ?? 0;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2002 || first === 0x3fff) return false;
  const second = groups[1] ?? 0;
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  return true;
}

function expandIPv6(address: string): readonly number[] | null {
  let head = address;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(head);
  if (dotted?.[1] !== undefined && dotted.index !== undefined) {
    const parts = dotted[1].split('.').map((part) => Number(part));
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null;
    }
    const high = parts[0] ?? 0;
    const mid = parts[1] ?? 0;
    const low = parts[2] ?? 0;
    const last = parts[3] ?? 0;
    tail.push((high << 8) | mid, (low << 8) | last);
    head = head.slice(0, dotted.index).replace(/:$/, '');
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const left = parseGroups(halves[0] ?? '');
  const right = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (left === null || right === null) return null;
  if (halves.length === 1 && left.length + tail.length !== 8) return null;
  const missing = 8 - tail.length - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right, ...tail];
}

function parseGroups(value: string): number[] | null {
  if (value === '') return [];
  const numbers: number[] = [];
  for (const group of value.split(':')) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    numbers.push(Number.parseInt(group, 16));
  }
  return numbers;
}
