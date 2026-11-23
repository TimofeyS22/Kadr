// localStorage and sessionStorage keys of the candidate (lib/stage.ts): Kadr keeps ~40 keys under «kadr.» in 19 files,
// and every one read on the live site's origin is the owner's. On the candidate each key is prefixed here, before
// any module reads one (main.tsx imports this first); the live site's code and keys are untouched. Kadr reads them
// only through getItem, setItem and removeItem (no key(), length or bracket access).
import { STAGE } from './stage';

if (STAGE && typeof Storage !== 'undefined') {
  const p = `${STAGE}:`;
  const proto = Storage.prototype;
  const { getItem, setItem, removeItem } = proto;
  proto.getItem = function (this: Storage, key: string) { return getItem.call(this, p + key); };
  proto.setItem = function (this: Storage, key: string, value: string) { setItem.call(this, p + key, value); };
  proto.removeItem = function (this: Storage, key: string) { removeItem.call(this, p + key); };
  // The candidate's own keys only: a clear() there must not empty the live site's.
  proto.clear = function (this: Storage) { for (const k of Object.keys(this)) if (k.startsWith(p)) removeItem.call(this, k); };
}
