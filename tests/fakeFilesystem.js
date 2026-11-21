/* A stand-in for Capacitor's Filesystem plugin that keeps files in memory and
   records every call. Binary writes (no encoding) are base64, decoded call
   by call and appended as bytes, as the plugin does on Android and the web;
   files are kept as latin-1 strings for binary, plain strings for text. */
export function fakeFilesystem({ existing = [], failOn } = {}) {
  const files = new Map(existing.map(([path, data]) => [path, data]));
  const calls = [];
  let n = 0;
  const fail = (op, path) => {
    n++;
    if (failOn && failOn({ op, path, n })) throw new Error(`fake ${op} failure`);
  };
  const decode = (data, encoding) => {
    if (encoding) return data;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("The supplied data is not valid base64 content.");
    return atob(data);
  };
  return {
    files,
    calls,
    async writeFile({ path, data, encoding, recursive }) {
      calls.push({ op: "writeFile", path, size: data.length, encoding, recursive, data });
      fail("writeFile", path);
      files.set(path, decode(data, encoding));
    },
    async appendFile({ path, data, encoding }) {
      calls.push({ op: "appendFile", path, size: data.length, encoding, data });
      fail("appendFile", path);
      files.set(path, (files.get(path) ?? "") + decode(data, encoding));
    },
    async rename({ from, to }) {
      calls.push({ op: "rename", from, to });
      fail("rename", to);
      if (!files.has(from)) throw new Error("missing source");
      if (files.has(to)) throw new Error("destination exists");
      files.set(to, files.get(from));
      files.delete(from);
    },
    async stat({ path }) {
      calls.push({ op: "stat", path });
      if (!files.has(path)) throw new Error("missing");
      return { size: files.get(path).length };
    },
    async readdir({ path }) {
      calls.push({ op: "readdir", path });
      return { files: [...files.keys()].filter((p) => p.startsWith(`${path}/`)).map((p) => ({ name: p.slice(path.length + 1) })) };
    },
    async deleteFile({ path }) {
      calls.push({ op: "deleteFile", path });
      if (!files.has(path)) throw new Error("missing");
      files.delete(path);
    },
  };
}
