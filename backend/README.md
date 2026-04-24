# HefflHoff backend

Minimal Node 18+ / Express / MongoDB / JWT save-game API.

## Setup

```bash
cd backend
cp .env.example .env       # edit MONGO_URI, JWT_SECRET, PORT, CORS_ORIGIN
npm install
npm start                  # or: npm run dev  (uses node --watch)
```

Requires a running MongoDB (local `mongod` or an Atlas cluster URI).

## Endpoints

| Method | Path                  | Auth   | Purpose                               |
| ------ | --------------------- | ------ | ------------------------------------- |
| POST   | `/api/auth/register`  | —      | Create account. Body: `{email,password}` |
| POST   | `/api/auth/login`     | —      | Log in. Returns `{token,user}`.       |
| GET    | `/api/save`           | Bearer | Fetch the current user's game state.  |
| PUT    | `/api/save`           | Bearer | Overwrite save. Body: `{gameState}`.  |
| DELETE | `/api/save`           | Bearer | Wipe save.                            |
| GET    | `/health`             | —      | Readiness probe.                      |

All successful auth responses include a JWT in `token`, valid 365 days.
Send it as `Authorization: Bearer <token>` on save-state requests.

## Game state shape

Kept free-form (`Mixed` in Mongoose) so the client can evolve. Current
fields the web client writes:

```json
{
  "v": 1,
  "inventory":  { "wood": 42, "grass": 99, "coin": 125, ...},
  "playerStats":{ "level": {"speed":1,"slashRadius":0}, ...},
  "userLevel":  { "level": 3, "xp": 2, "xpToNext": 7 },
  "helperStats":{ "level": 2, "capMul": 1.4, "speedMul": 1.15 },
  "builds":     { "hayBaler": {"completed":true,"level":2}, ... },
  "unlocks":    { "dairyLock": true, "expansion": true, ... },
  "farms":      [ {"tier":2,"cropKey":"tomato"}, ... ],
  "helpersCount": 2,
  "buildingWorkers": ["hayBaler","sawMill"],
  "farmWorkers": [0,1],
  "goals":      { "index": 7 },
  "lifetime":   { "coinsEarned":1234, "sold":{...}, "collected":{...} }
}
```
