import { EventEmitter } from 'events';
import Promise from 'bluebird';
import Stream from 'stream';
const { Readable } = Stream;

interface Data {
  data: any;
  modified: boolean;
}

class RouteStream extends Readable {
  public _data: any;
  public _ended: boolean;
  public modified: boolean;

  constructor(data: Data) {
    super({ objectMode: true });

    this._data = data.data;
    this._ended = false;
    this.modified = data.modified;
  }

  // Assume we only accept Buffer, plain object, or string
  _toBuffer(data: Buffer | object | string): Buffer | null {
    if (data instanceof Buffer) {
      return data;
    }
    if (typeof data === 'object') {
      data = JSON.stringify(data);
    }
    if (typeof data === 'string') {
      return Buffer.from(data); // Assume string is UTF-8 encoded string
    }
    return null;
  }

  _read(): boolean {
    const data = this._data;

    if (typeof data !== 'function') {
      const bufferData = this._toBuffer(data);
      if (bufferData) {
        this.push(bufferData);
      }
      this.push(null);
      return;
    }

    // Don't read it twice!
    if (this._ended) return false;
    this._ended = true;

    data().then(data => {
      if (data instanceof Stream && (data as Stream.Readable).readable) {
        data.on('data', d => {
          this.push(d);
        });

        data.on('end', () => {
          this.push(null);
        });

        data.on('error', err => {
          this.emit('error', err);
        });
      } else {
        const bufferData = this._toBuffer(data);
        if (bufferData) {
          this.push(bufferData);
        }
        this.push(null);
      }
    }).catch(err => {
      this.emit('error', err);
      this.push(null);
    });
  }
}

const _format = (path?: string): string => {
  path = path || '';
  if (typeof path !== 'string') throw new TypeError('path must be a string!');

  path = path
    .replace(/^\/+/, '') // Remove prefixed slashes
    .replace(/\\/g, '/') // Replaces all backslashes
    .replace(/\?.*$/, ''); // Remove query string

  // Appends `index.html` to the path with trailing slash
  if (!path || path.endsWith('/')) {
    path += 'index.html';
  }

  return path;
};

class Router extends EventEmitter {
  public routes: {
    [key: string]: Data | null;
  };

  constructor() {
    super();

    this.routes = {};
  }

  list(): string[] {
    const { routes } = this;
    return Object.keys(routes).filter(key => routes[key]);
  }

  format(path?: string): string {
    return _format(path);
  }

  get(path: string): RouteStream {
    if (typeof path !== 'string') throw new TypeError('path must be a string!');

    const data = this.routes[this.format(path)];
    if (data == null) return;

    return new RouteStream(data);
  }

  isModified(path: string): boolean {
    if (typeof path !== 'string') throw new TypeError('path must be a string!');

    const data = this.routes[this.format(path)];
    return data ? data.modified : false;
  }

  set(path: string, data: any): this {
    if (typeof path !== 'string') throw new TypeError('path must be a string!');
    if (data == null) throw new TypeError('data is required!');

    let obj: Data;

    if (typeof data === 'object' && data.data != null) {
      obj = data;
    } else {
      obj = {
        data,
        modified: true
      };
    }

    if (typeof obj.data === 'function') {
      if (obj.data.length) {
        obj.data = Promise.promisify(obj.data);
      } else {
        obj.data = Promise.method(obj.data);
      }
    }

    path = this.format(path);

    this.routes[path] = {
      data: obj.data,
      modified: obj.modified == null ? true : obj.modified
    };

    this.emit('update', path);

    return this;
  }

  remove(path: string): this {
    if (typeof path !== 'string') throw new TypeError('path must be a string!');
    path = this.format(path);

    this.routes[path] = null;
    this.emit('remove', path);

    return this;
  }
}

export = Router;
