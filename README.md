# 🏹 Arc Track

**Arc Track** is an archery scoring and performance analytics platform built for recurve and compound archers.

It allows archers to record training and competition sessions, plot arrows directly onto a target face, analyse performance over time, and share read-only performance data with authorised Head Coaches.

The goal of Arc Track is to go beyond simply recording scores by turning every plotted arrow into useful performance data.

---

## 🌐 Live Website

**https://archery-website.vercel.app**

---

## ✨ Features

Arc Track is built around five main areas:

- **Sessions**
- **Arrow Counter**
- **Analytics**
- **Organisation**
- **Profile**

Authentication is handled using Supabase Auth.

---

# 🎯 Sessions

Sessions are the main scoring workspace.

An archer can create either:

- **Training Sessions**
- **Competition Sessions**

Each Session can contain one or more Rounds.

The scoring hierarchy is:

```text
Session
└── Round
    └── End
        └── Arrow
```

Each Round stores its shooting configuration, including:

- Round name
- Division
- Distance
- Target face diameter
- Target face layout
- Planned number of Ends
- Arrows per End

Round numbering is handled by the database.

---

# 🏹 Target-Based Scoring

Arc Track uses a target-first scoring system.

Instead of manually entering every score, the archer can tap directly on the target where the Arrow landed.

```text
Tap target
→ calculate score
→ place Arrow marker
→ save Arrow
→ move to next Arrow
```

Arc Track currently supports:

- Full target faces
- 80 cm six-ring faces
- Triple faces

Each Arrow stores:

- Numeric score
- Whether the Arrow is an X
- Normalised X coordinate
- Normalised Y coordinate
- Triple-face index where applicable

Because the Arrow position is stored together with the score, the same data can later be used for grouping and performance analysis.

---

## Score Storage

Scores are stored numerically while X is tracked separately.

| Display | Score | X |
|---|---:|---:|
| X | 10 | Yes |
| 10 | 10 | No |
| 9–1 | 9–1 | No |
| M | 0 | No |

This keeps score calculations simple while still distinguishing an X from a normal 10.

---

# ✏️ Arrow Editing

Previously recorded Arrows can be selected and corrected.

An archer can:

- Move an Arrow marker
- Correct its score
- Clear its marker while keeping the score
- Delete the previous Arrow
- Retry a failed save

New Arrows automatically advance the scoring cursor.

Editing an existing Arrow keeps that Arrow selected instead of automatically advancing.

---

# 🔍 Target Zoom and Navigation

The scoring target supports:

- Zooming
- Panning
- Resetting the view

Arrow coordinates are stored using normalised target coordinates, so zooming or moving the target does not affect the saved Arrow position or calculated score.

---

# 📊 Round Insights

Each Round includes performance analysis based on the Arrows recorded.

Round Insights includes:

- Total score
- Number of Arrows
- Average score per Arrow
- X count
- 10 + X count
- Round completion
- End-by-End performance
- Grouping analysis

Grouping analysis includes:

- Group centre
- Group size
- RMS spread
- Possible flyers

The same scoring and grouping logic is shared across Arc Track to keep calculations consistent.

---

# 📈 Analytics

The Analytics page provides a wider view of an archer's performance across multiple Sessions.

Filters include:

- Training / Competition / All
- 7 days / 30 days / All time
- Distance
- Division
- Target face

Analytics includes:

- Total Arrows
- Average score
- X count
- 10 + X rate
- Best completed Round
- Performance trend
- Results by distance
- Grouping analysis
- Arrow volume
- Training vs Competition comparison

The aim is to make it easier to understand performance trends over time instead of only looking at individual scores.

---

# 🔢 Arrow Counter

Arc Track includes a lightweight Arrow Counter for training.

The counter is stored locally and does not require a Session to be created.

It supports:

- Custom Arrow increments
- Tap-to-add
- Undo
- Reset

This is useful when an archer only wants to track training volume without recording a full scoring Session.

---

# 👥 Organisations

Arc Track supports organisations for coach-athlete visibility.

Users can join an organisation using a join code.

New members join as **Archers**.

An organisation can contain:

- Archers
- Head Coaches

Head Coaches can view Sessions belonging to active Archer members of their organisation.

They can view:

- Sessions
- Rounds
- Scores
- Arrow plots
- Round Insights

Coach access is **read-only**.

A Head Coach cannot:

- Create Rounds for an athlete
- Modify an athlete's Arrows
- Change an athlete's scores
- Delete athlete data

Archers cannot view another Archer's Sessions.

If an Archer leaves an organisation, Head Coach access to that athlete's data is removed.

---

# 🔐 Authentication

Arc Track uses **Supabase Auth** for account management.

Supported flows include:

- Account creation
- Email verification
- Sign in
- Password recovery
- Password update
- Sign out

Registration and password recovery use six-digit email codes.

Protected pages require a valid authenticated session before they can be accessed.

Authentication is resolved before protected routes are shown so users do not briefly see private pages before identity verification completes.

---

# 🗄️ Database

Arc Track uses **PostgreSQL through Supabase**.

The main scoring structure is:

```text
auth.users
│
├── profiles
│
├── sessions
│   └── session_rounds
│       └── session_ends
│           └── arrows
│
└── organization_members
    └── organizations
```

Scores, totals and performance metrics are generally derived from Arrow records rather than stored separately.

This reduces duplicated data and helps keep calculations consistent.

---

# ⚙️ Atomic Round Creation

Round creation is handled by a PostgreSQL function:

```text
create_round_with_ends(...)
```

The database:

1. Locks the parent Session
2. Determines the next Round number
3. Creates the Round
4. Creates all planned Ends
5. Returns the new Round ID and Round number

These operations happen in a single database transaction.

If End creation fails, the Round creation is rolled back as well.

This prevents partially-created Rounds from being left in the database.

---

# 🛠️ Safe Round Updates

Existing Rounds can update supported settings through:

```text
update_owned_round_settings(...)
```

The owner can update:

- Round name
- Division
- Distance
- Target face diameter
- Planned Ends

If the number of planned Ends is increased, Arc Track appends the additional Ends without replacing the existing Round.

The update preserves:

- Round ID
- Round number
- Existing Ends
- Existing Arrows
- Scores
- X values
- Arrow coordinates

Face layout and Arrows per End remain fixed under the current update model.

---

# 🛡️ Security

Arc Track uses Supabase Row Level Security and database functions to enforce ownership and organisation access.

Important security rules include:

- Users control their own Sessions
- Archers cannot read another Archer's data
- Head Coaches receive read-only access to active Archers in shared organisations
- Coach access is removed when organisation membership ends
- Database functions verify the authenticated user before allowing protected writes
- Client applications never use a Supabase service-role key

The database remains the final security boundary even if client-side checks are bypassed.

---

# 🧠 Shared Scoring and Analytics Logic

Arc Track contains shared logic for:

- Target scoring
- Round presets
- Analytics calculations
- Grouping calculations
- Shared types
- Portable date utilities

This helps keep score calculations and analytics consistent across different parts of the project.

---

# 🧱 Tech Stack

## Frontend

- Next.js
- React
- TypeScript
- CSS Modules

## Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security
- PostgreSQL RPC functions

## Deployment

- Vercel

## Mobile

Arc Track also has an **Expo / React Native mobile application** in development.

The mobile application shares scoring, analytics, grouping and Round logic with the web application while keeping platform-specific navigation and gestures separate.

---

# 📁 Project Structure

```text
web/
├── src/
│   ├── app/                 Next.js routes
│   ├── components/          Shared web components
│   ├── features/            Feature-specific logic
│   └── styles/              Global styling
│
├── apps/
│   └── mobile/              Expo / React Native mobile app
│
├── packages/
│   └── core/                Shared scoring and analytics logic
│
├── supabase/
│   ├── migrations/          Database migrations
│   └── tests/               SQL rollback fixtures
│
├── tests/                   Web tests
│
├── package.json
└── README.md
```

---



# 💡 Why I Built Arc Track

Arc Track started from a simple problem:

> Most scoring tools tell an archer what they scored, but not necessarily how they are shooting.

As an archer, I wanted a system that could record both the score and physical position of every Arrow.

By storing both pieces of information, the same Arrow data can be used for:

```text
Scoring
+
Grouping
+
Performance trends
+
Training volume
+
Coach review
```

The goal of Arc Track is to give archers a clearer picture of their performance over time and make training data genuinely useful.