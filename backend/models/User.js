import mongoose from 'mongoose';

const { Schema } = mongoose;

// A single User owns one save slot. Everything game-related is kept in a
// free-form `gameState` object so schema evolution doesn't require a
// migration every time we add a resource or system to the client.
const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    gameState: {
      type: Schema.Types.Mixed,
      default: null,
    },
    savedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Strip hash before sending the user object over the wire.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    gameState: this.gameState || null,
    savedAt: this.savedAt,
  };
};

export const User = mongoose.model('User', userSchema);
