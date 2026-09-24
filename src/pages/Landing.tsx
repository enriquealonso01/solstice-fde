import { ChatWidget } from '@/components/chat'

/**
 * The guest-facing stage.
 *
 * Typography-driven on purpose: no stock photography to license, nothing that
 * dates, and every surface built from the `solstice` palette and the two fonts
 * already loaded in index.html. The page is not the product. The bubble in the
 * bottom-right corner and the phone number in the header are.
 */

/** Reserved-for-fiction number, used until Telnyx provisions the real line. */
const PLACEHOLDER_PHONE = '+18885550142'

const SUPPORT_PHONE_E164 = (import.meta.env.VITE_SUPPORT_PHONE || PLACEHOLDER_PHONE).trim()

/** Houses drawn from the group directory. Ten of a hundred and forty. */
const HOUSES = [
  { name: 'Riverwalk', city: 'Chicago', state: 'Illinois' },
  { name: 'Congress Ave', city: 'Austin', state: 'Texas' },
  { name: 'Union Station', city: 'Denver', state: 'Colorado' },
  { name: 'Music Row', city: 'Nashville', state: 'Tennessee' },
  { name: 'Bayshore', city: 'Tampa', state: 'Florida' },
  { name: 'Camelback', city: 'Phoenix', state: 'Arizona' },
  { name: 'Uptown', city: 'Charlotte', state: 'North Carolina' },
  { name: 'Capitol', city: 'Sacramento', state: 'California' },
  { name: 'Short North', city: 'Columbus', state: 'Ohio' },
  { name: 'Waterplace', city: 'Providence', state: 'Rhode Island' },
]

const PROMISES = [
  {
    index: '01',
    title: 'Someone answers',
    body: 'Day, night, holiday weekend. A real answer to a real question, not a queue position and a hold tone.',
  },
  {
    index: '02',
    title: 'We say what we can do',
    body: 'If the answer is no, you hear no, and you hear why. If it needs a manager, we go get the manager instead of guessing on your behalf.',
  },
  {
    index: '03',
    title: 'The room remembers you',
    body: 'Your preferences follow you across all 140 houses. Tell us once, in one city, and it holds in the next one.',
  },
]

const FACTS = [
  { value: '140', label: 'houses' },
  { value: '72h', label: 'free cancellation on flexible rates' },
  { value: '2pm', label: 'guaranteed Platinum check-out' },
  { value: '24/7', label: 'a person, or Sol' },
]

export default function Landing() {
  const phoneHref = 'tel:' + SUPPORT_PHONE_E164
  const phoneDisplay = formatPhone(SUPPORT_PHONE_E164)

  return (
    <div className="min-h-screen bg-solstice-cream text-solstice-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-solstice-ink focus:px-4 focus:py-2 focus:text-sm focus:text-solstice-cream"
      >
        Skip to content
      </a>

      <SiteHeader phoneHref={phoneHref} phoneDisplay={phoneDisplay} />

      <main id="main">
        <Hero phoneHref={phoneHref} phoneDisplay={phoneDisplay} />
        <FactBand />
        <Promise />
        <Directory />
        <GroupsBand />
        <HelpBand phoneHref={phoneHref} phoneDisplay={phoneDisplay} />
      </main>

      <SiteFooter phoneHref={phoneHref} phoneDisplay={phoneDisplay} />

      <ChatWidget />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Header                                                               *
 * ------------------------------------------------------------------ */

interface PhoneProps {
  phoneHref: string
  phoneDisplay: string
}

function SiteHeader({ phoneHref, phoneDisplay }: PhoneProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-solstice-sand/70 bg-solstice-cream/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5 sm:px-8">
        <a href="/" className="group flex shrink-0 items-baseline gap-2.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40">
          <span className="font-display text-[22px] leading-none tracking-[0.18em] text-solstice-ink">
            SOLSTICE
          </span>
          <span className="hidden text-[9.5px] uppercase tracking-[0.3em] text-solstice-stone sm:inline">
            Hotel Group
          </span>
        </a>

        <nav aria-label="Primary" className="hidden flex-1 justify-center gap-8 lg:flex">
          {['Stays', 'Destinations', 'Groups & Events', 'Loyalty'].map((item) => (
            <a
              key={item}
              href={item === 'Destinations' ? '#destinations' : item === 'Groups & Events' ? '#groups' : '#main'}
              className="relative text-[13px] text-solstice-slate transition hover:text-solstice-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <a
            href={phoneHref}
            className="hidden items-center gap-2 rounded-full border border-solstice-sand px-3.5 py-1.5 text-[13px] text-solstice-slate transition hover:border-solstice-stone/40 hover:text-solstice-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40 sm:inline-flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-solstice-gold" aria-hidden="true" />
            <span className="tabular-nums">{phoneDisplay}</span>
          </a>
          <a
            href="#main"
            className="rounded-full bg-solstice-ink px-4 py-2 text-[13px] font-medium text-solstice-cream transition hover:bg-solstice-slate focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
          >
            Reserve
          </a>
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Hero                                                                 *
 * ------------------------------------------------------------------ */

function Hero({ phoneHref, phoneDisplay }: PhoneProps) {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(120%_85%_at_50%_-10%,#FDFAF5_0%,#F7F3EC_48%,#EFE6D8_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(38%_46%_at_82%_14%,rgba(200,151,63,0.30),transparent_68%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(34%_44%_at_12%_82%,rgba(180,84,31,0.13),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-px bg-gradient-to-r from-transparent via-solstice-sand to-transparent"
      />

      <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:pb-36 lg:pt-32">
        <p className="mb-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] uppercase tracking-[0.26em] text-solstice-stone">
          <span>140 houses</span>
          <span aria-hidden="true" className="h-3 w-px bg-solstice-sand" />
          <span>Coast to coast</span>
          <span aria-hidden="true" className="h-3 w-px bg-solstice-sand" />
          <span>One standard</span>
        </p>

        <h1 className="max-w-[16ch] font-display text-[clamp(2.75rem,8.4vw,6.25rem)] font-light leading-[0.95] tracking-[-0.02em] text-solstice-ink">
          Treating guests like people,{' '}
          <span className="relative inline-block italic text-solstice-ember">
            not folio numbers
            <span
              aria-hidden="true"
              className="absolute -bottom-1 left-0 h-px w-full bg-gradient-to-r from-solstice-ember/60 to-transparent"
            />
          </span>
          .
        </h1>

        <p className="mt-8 max-w-[52ch] text-[15px] leading-relaxed text-solstice-slate sm:text-base">
          Upper-midscale hotels in the parts of American cities worth walking. Rooms you can
          actually work in, front desks that are actually staffed, and a concierge that answers
          the first time you ask.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href="#destinations"
            className="inline-flex items-center justify-center rounded-full bg-solstice-ink px-6 py-3 text-sm font-medium text-solstice-cream transition hover:bg-solstice-slate focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40 focus-visible:ring-offset-2 focus-visible:ring-offset-solstice-cream"
          >
            Find a stay
          </a>
          <a
            href={phoneHref}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-solstice-stone/25 px-6 py-3 text-sm text-solstice-slate transition hover:border-solstice-stone/50 hover:text-solstice-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
          >
            Call <span className="tabular-nums">{phoneDisplay}</span>
          </a>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Bands                                                                *
 * ------------------------------------------------------------------ */

function FactBand() {
  return (
    <section aria-label="At a glance" className="border-b border-solstice-sand bg-white/60">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-solstice-sand/70 sm:grid-cols-4">
        {FACTS.map((fact) => (
          <div key={fact.label} className="bg-solstice-cream px-5 py-7 sm:px-8 sm:py-9">
            <dt className="sr-only">{fact.label}</dt>
            <dd>
              <span className="block font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-none text-solstice-ink">
                {fact.value}
              </span>
              <span className="mt-2 block text-[11px] uppercase leading-snug tracking-[0.14em] text-solstice-stone">
                {fact.label}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Promise() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="mb-4 text-[10.5px] uppercase tracking-[0.26em] text-solstice-stone">
            The promise
          </p>
          <h2 className="font-display text-[clamp(1.9rem,4.2vw,3rem)] font-light leading-[1.05] tracking-[-0.015em] text-solstice-ink">
            A folio number is how we bill you. It is not who you are.
          </h2>
        </div>

        <ul className="grid gap-px bg-solstice-sand/70 sm:grid-cols-3 lg:gap-px">
          {PROMISES.map((promise) => (
            <li key={promise.index} className="bg-solstice-cream px-0 py-6 sm:px-6 sm:py-2">
              <span className="font-display text-[13px] tracking-[0.2em] text-solstice-gold">
                {promise.index}
              </span>
              <h3 className="mt-3 font-display text-[21px] leading-tight text-solstice-ink">
                {promise.title}
              </h3>
              <p className="mt-2.5 text-[14px] leading-relaxed text-solstice-slate">{promise.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Directory() {
  return (
    <section
      id="destinations"
      className="scroll-mt-20 border-y border-solstice-sand bg-white/50 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-4 text-[10.5px] uppercase tracking-[0.26em] text-solstice-stone">
              Destinations
            </p>
            <h2 className="font-display text-[clamp(1.9rem,4.2vw,3rem)] font-light leading-[1.05] tracking-[-0.015em] text-solstice-ink">
              Ten of the hundred and forty.
            </h2>
          </div>
          <a
            href="#main"
            className="text-[13px] text-solstice-ember underline underline-offset-4 transition hover:text-solstice-ember/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
          >
            See every house
          </a>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-x-14 md:grid-cols-2">
          {HOUSES.map((house) => (
            <li key={house.name + house.city} className="border-t border-solstice-sand">
              <a
                href="#main"
                className="group flex items-baseline gap-4 py-5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
              >
                <span className="font-display text-[clamp(1.3rem,2.6vw,1.7rem)] leading-none text-solstice-ink transition group-hover:text-solstice-ember">
                  {house.city}
                </span>
                <span className="text-[13px] text-solstice-stone">Solstice {house.name}</span>
                <span className="ml-auto hidden text-[11px] uppercase tracking-[0.14em] text-solstice-stone/70 sm:block">
                  {house.state}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function GroupsBand() {
  return (
    <section id="groups" className="relative isolate scroll-mt-20 overflow-hidden bg-solstice-ink">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(70%_120%_at_88%_0%,rgba(200,151,63,0.26),transparent_62%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(50%_90%_at_6%_100%,rgba(180,84,31,0.22),transparent_60%)]"
      />

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:items-end lg:gap-20">
        <div>
          <p className="mb-4 text-[10.5px] uppercase tracking-[0.26em] text-solstice-gold/80">
            Groups &amp; events
          </p>
          <h2 className="font-display text-[clamp(1.9rem,4.6vw,3.2rem)] font-light leading-[1.05] tracking-[-0.015em] text-solstice-cream">
            Ten rooms or two hundred, you get an answer the same day.
          </h2>
        </div>

        <div>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-solstice-cream/70">
            Tell us the dates, the headcount and what the room has to do. Our group desk comes back
            with real availability, a real rate and the terms in writing. If a request sits outside
            what we can approve, we say so up front rather than three emails later.
          </p>
          <a
            href="#main"
            className="mt-8 inline-flex items-center justify-center rounded-full bg-solstice-cream px-6 py-3 text-sm font-medium text-solstice-ink transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-gold focus-visible:ring-offset-2 focus-visible:ring-offset-solstice-ink"
          >
            Start a group inquiry
          </a>
        </div>
      </div>
    </section>
  )
}

function HelpBand({ phoneHref, phoneDisplay }: PhoneProps) {
  return (
    <section aria-labelledby="help-heading" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-20">
        <div>
          <p className="mb-4 text-[10.5px] uppercase tracking-[0.26em] text-solstice-stone">
            Guest support
          </p>
          <h2
            id="help-heading"
            className="font-display text-[clamp(1.9rem,4.2vw,3rem)] font-light leading-[1.05] tracking-[-0.015em] text-solstice-ink"
          >
            Call the line. It is answered.
          </h2>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-solstice-slate">
            Sol picks up on the first ring, any hour, and hands you to a person the moment something
            needs one. The same Sol is in the corner of this page if you would rather type.
          </p>
        </div>

        <div className="rounded-2xl border border-solstice-sand bg-white p-7 shadow-sm sm:p-9">
          <p className="text-[11px] uppercase tracking-[0.18em] text-solstice-stone">
            Guest support line
          </p>
          <a
            href={phoneHref}
            className="mt-3 block font-display text-[clamp(1.85rem,5.2vw,2.75rem)] leading-none tracking-tight text-solstice-ink transition hover:text-solstice-ember focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
          >
            <span className="tabular-nums">{phoneDisplay}</span>
          </a>
          <p className="mt-4 text-[13px] leading-relaxed text-solstice-stone">
            Open 24 hours, every day, including holidays. Reservations, changes, billing questions
            and anything that went wrong during a stay.
          </p>
        </div>
      </div>
    </section>
  )
}

function SiteFooter({ phoneHref, phoneDisplay }: PhoneProps) {
  return (
    <footer className="border-t border-solstice-sand bg-solstice-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-[17px] tracking-[0.18em] text-solstice-ink">SOLSTICE</span>
          <span className="text-[9.5px] uppercase tracking-[0.3em] text-solstice-stone">Hotel Group</span>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-solstice-stone">
          {['Accessibility', 'Privacy', 'Terms', 'Careers'].map((item) => (
            <a
              key={item}
              href="#main"
              className="transition hover:text-solstice-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
            >
              {item}
            </a>
          ))}
          <a
            href={phoneHref}
            className="tabular-nums transition hover:text-solstice-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
          >
            {phoneDisplay}
          </a>
        </nav>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ *
 * Helpers                                                              *
 * ------------------------------------------------------------------ */

/** E.164 in, readable US formatting out. Anything unexpected is shown as-is. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+1 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7)
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6)
  }
  return raw
}
