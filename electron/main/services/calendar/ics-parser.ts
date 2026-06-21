// Parser de iCalendar (RFC 5545) MÍNIMO e PURO — sem dependência externa nem I/O.
// Cobre só o que a ativação por Google Calendar precisa: VEVENTs com
// DTSTART/DTEND/SUMMARY/DESCRIPTION/LOCATION/URL/ATTENDEE + detecção do link do
// Google Meet. Não tenta ser um parser ICS completo (RRULE, VTIMEZONE, VALARM
// etc. são ignorados) — o feed secreto do Google já entrega as ocorrências
// expandidas em UTC, então recorrência não precisa ser resolvida aqui.

export interface CalendarEvent {
  uid: string | null
  summary: string | null
  description: string | null
  location: string | null
  url: string | null
  // Epoch ms (UTC). null se DTSTART/DTEND ausentes ou não-parseáveis.
  startMs: number | null
  endMs: number | null
  // E-mails dos ATTENDEE (mailto: removido). Inclui o organizer se presente.
  attendees: string[]
  // Primeiro link meet.google.com/... achado em location/description/url. null se
  // o evento não é uma reunião do Meet.
  meetUrl: string | null
}

interface RawLine {
  // Nome da propriedade em MAIÚSCULAS, sem os parâmetros (ex: 'DTSTART').
  name: string
  // Mapa de parâmetros (ex: { TZID: 'America/Sao_Paulo', VALUE: 'DATE' }).
  params: Record<string, string>
  value: string
}

// Google Meet sempre vive em meet.google.com/<code>. Regex tolerante: aceita com
// ou sem https://, captura o path do código. `i` porque alguns clients gravam o
// host em maiúsculas.
const MEET_RE = /https?:\/\/meet\.google\.com\/[a-z0-9-]+/i

// ---- unfolding (RFC 5545 §3.1) ----

// Linhas dobradas continuam na linha seguinte iniciada por espaço ou TAB. O
// CRLF + o whitespace líder somem; o resto concatena. Aceita LF puro (alguns
// feeds usam \n) além do CRLF canônico.
export function unfoldLines(raw: string): string[] {
  const physical = raw.split(/\r\n|\r|\n/)
  const logical: string[] = []
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1)
    } else {
      logical.push(line)
    }
  }
  return logical
}

// ---- parse de uma linha "NAME;PARAM=val:value" ----

function parseLine(line: string): RawLine | null {
  const colon = line.indexOf(':')
  if (colon === -1) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)

  const parts = head.split(';')
  const name = (parts[0] ?? '').toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq === -1) continue
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
  }
  return { name, params, value }
}

// ---- unescape de TEXT (RFC 5545 §3.3.11) ----

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

// ---- DATE-TIME → epoch ms (RFC 5545 §3.3.5) ----

// Formas aceitas:
//   20260620T143000Z         → UTC absoluto
//   20260620T143000          → "floating"/local (sem TZID): tratamos como UTC
//                              (best-effort; o feed do Google usa Z ou TZID).
//   TZID=...:20260620T143000 → com timezone nomeada (offset resolvido abaixo).
//   20260620 (VALUE=DATE)    → dia inteiro: meia-noite UTC.
// Datas inválidas → null (o chamador filtra eventos sem horário).
export function parseIcsDate(value: string, params: Record<string, string> = {}): number | null {
  const v = value.trim()
  // All-day (VALUE=DATE): YYYYMMDD.
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (dateOnly) {
    const [, y, mo, d] = dateOnly
    return Date.UTC(+y, +mo - 1, +d)
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  if (z === 'Z') return utc

  // Sem Z. Se há TZID conhecida, resolve o offset via Intl; senão trata como UTC.
  const tzid = params.TZID
  if (tzid) {
    const off = tzOffsetMs(tzid, utc)
    if (off !== null) return utc - off
  }
  return utc
}

// Offset (ms) de uma timezone nomeada NUM dado instante. Usa Intl.DateTimeFormat
// (sem libs). Retorna ms a SOMAR ao horário local pra chegar no UTC equivalente
// — ou seja, (localAsUtc - offset) = utcReal. null se a TZID é desconhecida.
function tzOffsetMs(tzid: string, utcGuess: number): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(utcGuess))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    // asUtc é o "wall clock" da TZID reinterpretado como UTC. A diferença pro
    // instante real é o offset da zona.
    return asUtc - utcGuess
  } catch {
    return null
  }
}

// ---- extração do Meet link ----

export function extractMeetUrl(event: {
  location: string | null
  description: string | null
  url: string | null
}): string | null {
  for (const field of [event.url, event.location, event.description]) {
    if (!field) continue
    const m = MEET_RE.exec(field)
    if (m) return m[0]
  }
  return null
}

// ---- parse do calendário inteiro ----

export function parseIcs(raw: string): CalendarEvent[] {
  const lines = unfoldLines(raw)
  const events: CalendarEvent[] = []

  let inEvent = false
  let cur: {
    uid: string | null
    summary: string | null
    description: string | null
    location: string | null
    url: string | null
    startMs: number | null
    endMs: number | null
    attendees: string[]
  } | null = null

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue
    const { name, params, value } = parsed

    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') {
      inEvent = true
      cur = {
        uid: null,
        summary: null,
        description: null,
        location: null,
        url: null,
        startMs: null,
        endMs: null,
        attendees: [],
      }
      continue
    }
    if (name === 'END' && value.trim().toUpperCase() === 'VEVENT') {
      if (cur) {
        const meetUrl = extractMeetUrl(cur)
        events.push({ ...cur, meetUrl })
      }
      inEvent = false
      cur = null
      continue
    }
    if (!inEvent || !cur) continue

    switch (name) {
      case 'UID':
        cur.uid = value.trim()
        break
      case 'SUMMARY':
        cur.summary = unescapeText(value)
        break
      case 'DESCRIPTION':
        cur.description = unescapeText(value)
        break
      case 'LOCATION':
        cur.location = unescapeText(value)
        break
      case 'URL':
        cur.url = value.trim()
        break
      case 'DTSTART':
        cur.startMs = parseIcsDate(value, params)
        break
      case 'DTEND':
        cur.endMs = parseIcsDate(value, params)
        break
      case 'ATTENDEE':
      case 'ORGANIZER': {
        const email = extractEmail(value, params)
        if (email && !cur.attendees.includes(email)) cur.attendees.push(email)
        break
      }
    }
  }

  return events
}

// ATTENDEE/ORGANIZER vêm como `mailto:foo@bar.com` no value (ou em CN/EMAIL
// param em raros clients). Normaliza pro e-mail puro.
function extractEmail(value: string, params: Record<string, string>): string | null {
  const v = value.trim()
  const mailto = /^mailto:(.+)$/i.exec(v)
  if (mailto) return mailto[1].trim()
  if (params.EMAIL) return params.EMAIL.trim()
  if (v.includes('@')) return v
  return null
}
