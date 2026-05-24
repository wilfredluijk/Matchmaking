# Cup Competition Match Form (Bekercompetitie)

A single-file web app that generates the complete match schedule, table
assignment and per-match handicap (*voorgift*) for an
**NTTB Afdeling Oost Bekercompetitie** cup tie between two teams of four players.

The interface is English. There is no build step and no runtime dependency
other than Google Fonts.

## What the app does

You enter:

- match metadata (date, pool, match number, club submitting the form),
- the two teams (Team A — home, Team B — away), their club/team names and
  four players each (slot label, name, ELO rating).

The app then renders the full 18-match programme on the printed scoresheet,
with table assignment and the correct handicap for every match. Game scores
and the final result are left blank so the form can be filled in at the
table (or printed and used on paper).

## Domain rules

### Teams & format

- Two teams of four players: Team A = A1–A4, Team B = B1–B4.
- 18 matches total: 16 singles + 2 doubles.
- Sets are best of 5 games to 11 points. Each won set = 1 point.
- Two tables are used in parallel:
  - **odd** match number → Table 1,
  - **even** match number → Table 2.

### Match order (official sequence)

| # | Match            | # | Match                              |
|---|------------------|---|------------------------------------|
| 1 | A1 – B3          | 10| Doubles A3+A4 vs B1+B2             |
| 2 | A2 – B4          | 11| A1 – B2                            |
| 3 | A3 – B1          | 12| A2 – B1                            |
| 4 | A4 – B2          | 13| A3 – B4                            |
| 5 | A1 – B4          | 14| A4 – B3                            |
| 6 | A2 – B3          | 15| A1 – B1                            |
| 7 | A3 – B2          | 16| A2 – B2                            |
| 8 | A4 – B1          | 17| A3 – B3                            |
| 9 | Doubles A1+A2 vs B3+B4 | 18 | A4 – B4                       |

### Handicap table

The lower-rated side gets a head start each game. The head start is computed
from the **absolute** rating difference:

| Rating difference | Head start |
|-------------------|------------|
| 0 – 135           | 0          |
| 136 – 270         | 2          |
| 271 – 305         | 3          |
| 306 – 440         | 4          |
| 441 – 575         | 5          |
| 576 – 810         | 6          |
| 811 or more       | 7 (max)    |

### Singles handicap

For each single, the rating difference between the two players is fed into
the table above. The lower-rated player receives the head start. The form
displays the head start as `A : x – B : 0` (or the mirror).

### Doubles handicap

Per the official rules:

1. Take the handicap for the difference between the two **highest-rated**
   players (one from each team).
2. Take the handicap for the difference between the two **lowest-rated**
   players (one from each team).
3. Add both handicap values and divide by 2, then round **up**
   (`Math.ceil`).
4. The pair with the **lower average** rating receives the head start.

#### Verified against the official example

> A = 1448 & 860, B = 1257 & 561
>
> highest diff = 191 → 2, lowest diff = 299 → 3,
> combined = `ceil((2 + 3) / 2)` = 3,
> Team B has the lower average rating (909 < 1154) and therefore receives
> the head start.

The app's `doublesHandicap` function is asserted against this example on
load; a failed self-check is logged to the browser console. The handicap
function was additionally verified in Node against every boundary value of
the table above and against the official doubles example.

## How to use

1. Open `index.html` in any modern browser. There is no build step.
2. Fill in the match metadata at the top.
3. Enter each team's club/team name and the four players (name + rating).
4. Click **Calculate schedule & handicap**.
   The 18-match schedule appears with the correct table number and the
   exact head start for every match.
5. Click **Print / Save as PDF** to print the form or save it as a PDF.
   The action buttons and reference section are hidden in the print layout.

Other buttons:

- **Fill example** — loads a representative tie (including the official
  doubles example) so you can see the form working end-to-end.
- **Clear** — empties all fields and the schedule.

If a player's rating is missing, the affected matches show
`rating missing` and the form keeps working — it never crashes.

## How to run it

There is nothing to install. Open the file:

```text
cup/index.html
```

directly in a browser, or serve the project root with any static file
server.

## Design notes

- All CSS and JavaScript are inline in `index.html` — no build step.
- The only external dependency is the Google Fonts CSS (Big Shoulders
  Display + JetBrains Mono).
- All state is kept in memory; the app does **not** use `localStorage`
  or `sessionStorage`.
- Print stylesheet: buttons, the reference section, and the navigation
  crumb are hidden; the schedule is preserved with the table colour
  badges so the printed sheet is unambiguous on paper.
