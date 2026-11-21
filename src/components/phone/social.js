import { YOU, addMessage, addPost, addStory, phoneAct, setPostImage, toggleLike, toggleRepost, traitsOf } from "../../lib/phone.js";
import { ageUnits, itemMinutes, timeLabel } from "../../lib/phoneClock.js";
import { ownPostPot, personaAction, statsOf } from "../../lib/phoneStats.js";

/* ---------- what the social screens read and write ----------

   Shown counts and ages (phoneStats.js over the phone's clock, phoneClock.js), and the
   persona's local actions as `act` patches (phone.js). Nothing here calls a
   model: an action marks the handset pending and asks the chat's phone job
   for a reply later (`tick.later`). Phone.jsx puts these on `ctx`. */

/* A post's age in statsOf units (30 in-world minutes) on the phone's clock
   (phoneClock.js): now - post.at; posts without `at` (or no handset) use
   the old reply clock. */
export const ageFor = (post, messages, handset) => ageUnits(post, handset, messages);

/* "now", "12m", "3h", "2d", "3w", "4mo" */
export const ageLabel = (item, messages, handset) => timeLabel(itemMinutes(item, handset, messages));

/* The counts a post shows: the stored floor rising toward its ceiling as the
   story goes on; replies and quotes never below the real ones in the feed. */
export function shownStats(post, messages, posts = [], handset) {
  const s = statsOf(post, ageFor(post, messages, handset));
  let replies = 0;
  let quotes = 0;
  for (const p of posts) {
    if (p.ref !== post.id) continue;
    if (p.kind === "reply") replies++;
    else if (p.kind === "quote") quotes++;
  }
  return { ...s, replies: Math.max(s.replies, replies), quotes: Math.max(s.quotes, quotes) };
}

/* The verified check: another account's own flag, or for the persona
   `h.me.verified` when the handset has it (read only; false by default). */
export const isVerified = (h, key) => (key === YOU ? h?.me?.verified === true : !!h?.people?.[key]?.verified);

const pending = (h) => ({ ...h, tick: { ...h.tick, pending: true } });

/* The persona's actions, each one chat patch through `act(fn(handset, chat))`.
   Every write goes through phoneAct (phone.js): the item is dated at the
   phone's now plus what it costs (PHONE_COST), hung loose on the chat's last
   message (so a swipe or regenerate keeps it), and the phone's clock moves
   on by that cost. Likes and reposts cost nothing. */
export function phoneWrites({ act, tick }) {
  const later = (hint) => tick?.later?.(hint);
  const write = (kind, fn) => act((x, c) => phoneAct(x, c?.messages, kind, (h, o) => fn(h, o, c)));
  return {
    like(post) {
      act((x) => pending(toggleLike(x, post.id)));
      later({ action: { kind: "like", post: post.id } });
    },
    /* on: reposts +1 (and, for a famous persona reposting a small account,
       a lifted ceiling); off again on a second tap */
    repost(post) {
      act((x, c) => {
        const p = x.posts.find((q) => q.id === post.id);
        if (!p) return x;
        const me = traitsOf(x.me);
        const author = traitsOf(x.people[p.by]);
        if (p.reposted || !(me.fame >= 2 && author.fame <= 1)) return pending(toggleRepost(x, p.id));
        const lifted = { ...personaAction(p, "repost", { persona: me, author, age: ageFor(p, c?.messages, x) }), reposted: true };
        return pending({ ...x, posts: x.posts.map((q) => (q.id === p.id ? lifted : q)) });
      });
      later({ action: { kind: "repost", post: post.id } });
    },
    reply(post, text) {
      write("reply", (h, o) => addPost(h, { kind: "reply", ref: post.id, text, ...at(o) }, o.anchor));
      later();
    },
    /* a public comment under a story: a reply whose ref is the story */
    comment(story, text) {
      write("comment", (h, o) => addPost(h, { kind: "reply", ref: story.id, text, ...at(o) }, o.anchor));
      later();
    },
    quote(post, text, photo = "") {
      write("quote", (h, o) => addPost(h, { kind: "quote", ref: post.id, text, photo, ...at(o) }, o.anchor));
      later();
    },
    /* the persona's own post: text, a described photo, or a device picture */
    post({ text = "", photo = "", image = null }) {
      write("post", (x, o) => {
        const pic = photo || (image ? "A photo" : "");
        const pot = ownPostPot(traitsOf(x.me), x.me.followers, `${x.tick.n}:${text}:${pic}`);
        const next = addPost(x, { text, photo: pic, pot, ...at(o) }, o.anchor);
        const made = next.posts[0];
        return image && made && made.by === YOU && made.id !== x.posts[0]?.id ? setPostImage(next, made.id, image) : next;
      });
      later();
    },
    story({ text = "", photo = "", image = null }) {
      write("story", (x, o) => {
        const pic = photo || (image ? "A photo" : "");
        const next = addStory(x, { text, photo: pic, ...at(o) }, o.anchor);
        const made = next.stories[0];
        return image && made && made.id !== x.stories[0]?.id ? setPostImage(next, made.id, image) : next;
      });
    },
    dm(key, text) {
      write("dm", (h, o) => addMessage(h, key, text, o.anchor, at(o)));
      later({ dm: true });
    },
  };
}

/* { at } from phoneAct's options, or {} before the phone is set up */
const at = (o) => (Number.isFinite(o?.at) ? { at: o.at } : {});
