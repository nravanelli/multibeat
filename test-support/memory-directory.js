// In-memory File System Access fixture with byte offsets and atomic close semantics.
export function memoryDirectory({ beforeOperation = () => {}, afterClose = () => {} } = {}) {
  const files = new Map();
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const directory = path => ({
    name: path.split('/').at(-1) || 'output',
    getDirectoryHandle: async name => directory(path ? path + '/' + name : name),
    getFileHandle: async (name, { create = false } = {}) => {
      const file = path ? path + '/' + name : name;
      if (!files.has(file)) {
        if (!create) throw new Error('Missing file: ' + file);
        files.set(file, new Uint8Array());
      }
      return {
        getFile: async () => ({ size: files.get(file).byteLength }),
        createWritable: async ({ keepExistingData = false } = {}) => {
          let bytes = keepExistingData ? files.get(file).slice() : new Uint8Array(), position = 0, closed = false;
          const check = operation => { if (closed) throw new Error('Stream closed'); beforeOperation(operation, file); };
          return {
            seek: async offset => { check('seek'); position = offset; },
            write: async value => {
              check('write');
              const incoming = typeof value === 'string' ? encoder.encode(value) : value;
              const next = new Uint8Array(Math.max(bytes.byteLength, position + incoming.byteLength));
              next.set(bytes); next.set(incoming, position); bytes = next; position += incoming.byteLength;
            },
            truncate: async length => { check('truncate'); const next = new Uint8Array(length); next.set(bytes.subarray(0, length)); bytes = next; position = Math.min(position, length); },
            close: async () => { check('close'); files.set(file, bytes); closed = true; afterClose(file); },
            abort: async () => { closed = true; }
          };
        }
      };
    }
  });
  return { directory: directory(''), files, text: path => files.has(path) ? decoder.decode(files.get(path)) : undefined };
}
