const storyAudio = name => `opening/audio/${name}`;
const OPENING_THEME = storyAudio('00-opening-story-theme');
const cue = (name, delay, duckMusic) => ({ track: storyAudio(name), delay, duckMusic });
const SCENES = [
  {
    image: '01-earthfall',
    alt: 'A blue meteor streaks towards Earth.',
    caption: ['Something hungry fell out of the sky.'],
    cues: [cue('01-meteor-pass')],
  },
  {
    image: '02-impact',
    alt: 'The meteor strikes the muddy street outside the Old Pub.',
    caption: ['It hit the street outside the Old Pub. Inside, nobody missed a hand.'],
    cues: [cue('02-crater-impact'), cue('04-alien-pulse', 1.8)],
  },
  {
    image: '03-out-on-the-street',
    alt: 'The gambler is thrown through the pub window in a shower of glass.',
    caption: [
      'I came in for a drink. I was a coin short.',
      '“Come back when you can pay for what you order!”',
    ],
    cues: [cue('03-window-break')],
  },
  {
    image: '04-the-gem',
    alt: 'The gambler reaches for a glowing gem in the crater.',
    caption: ['Something in the crater was beating. My heart fell into step.'],
    cues: [cue('04-alien-pulse')],
  },
  {
    image: '05-the-bond',
    alt: 'Black tendrils coil around the gambler’s arm and shoulder.',
    caption: ['The instant I touched it, it climbed my arm. By the time I screamed, it was under my skin.'],
    cues: [cue('05-tendril-wrap'), cue('05-pain-scream', .85, true)],
  },
  {
    image: '06-the-price',
    alt: 'The symbiote grins through one half of the gambler’s face.',
    caption: [
      '“Feed me <strong>DIAMONDS</strong>. If I starve, I’ll eat you from the inside.”',
      'The jeweller was two doors down. I could buy diamonds with poker winnings. First I had to win.',
    ],
    cues: [cue('06-heartbeat', .4)],
  },
  {
    image: '07-back-inside',
    alt: 'The gambler walks back into the lit pub past the broken window.',
    caption: ['I opened the door this time.', '“Deal me in, Abner.”'],
    cues: [cue('07-pub-door')],
  },
];

export class OpeningStory {
  #scene = -1;
  #element = document.getElementById('opening');
  #art = document.getElementById('opening-art');
  #caption = document.getElementById('opening-caption');
  #next = document.getElementById('opening-next');
  #audio;
  #onFinish;

  constructor(audio, onFinish) {
    this.#audio = audio;
    this.#onFinish = onFinish;
    this.#next.addEventListener('click', () => this.#advance());
    document.getElementById('opening-skip').addEventListener('click', () => this.#finish());
    this.#element.addEventListener('click', event => {
      if (!event.target.closest('button')) this.#advance();
    });

    for (const scene of SCENES.slice(1)) new Image().src = this.#artPath(scene);
    audio.preload([OPENING_THEME, 'old-pub', ...new Set(SCENES.flatMap(
      scene => scene.cues.map(({ track }) => track),
    ))]);
  }

  get active() {
    return !this.#element.hidden;
  }

  open() {
    this.#scene = -1;
    this.#element.hidden = false;
    this.#showArt(SCENES[0]);
    this.#caption.replaceChildren();
    this.#next.textContent = 'Start story';
    this.#next.focus();
    this.#audio.playScene();
    this.#audio.playMusic(null);
  }

  #artPath(scene) {
    return `./assets/opening/${scene.image}.png`;
  }

  #showArt(scene) {
    this.#art.src = this.#artPath(scene);
    this.#art.alt = scene.alt;
  }

  #advance() {
    this.#scene++;
    const scene = SCENES[this.#scene];
    if (!scene) {
      this.#finish();
      return;
    }
    this.#audio.unlock();
    this.#showArt(scene);
    this.#caption.innerHTML = scene.caption.map(paragraph => `<p>${paragraph}</p>`).join('');
    this.#next.textContent = this.#scene === SCENES.length - 1 ? 'Enter the Old Pub' : 'Continue';
    this.#audio.playScene(scene.cues);
    if (this.#scene === 0) this.#audio.playMusic(OPENING_THEME, .7);
  }

  #finish() {
    this.#audio.unlock();
    this.#audio.playScene();
    this.#element.hidden = true;
    this.#onFinish();
  }
}
