# Plasmic User Creation Guide

## Overview

This guide explains how to create users in Plasmic, covering multiple approaches from programmatic creation to direct database insertion. Users in Plasmic require proper setup including personal teams, workspaces, and permissions.

## Table of Contents

1. [User Creation Methods](#user-creation-methods)
2. [Programmatic User Creation (TypeScript)](#programmatic-user-creation-typescript)
3. [Direct Database Creation (SQL)](#direct-database-creation-sql)
4. [User Verification](#user-verification)
5. [Best Practices](#best-practices)
6. [Common Issues](#common-issues)

## User Creation Methods

There are three main approaches to create users in Plasmic:

1. **Standard Registration Flow** - Users sign up through the web interface
2. **Programmatic Creation** - Using TypeScript scripts with the DbMgr API
3. **Direct Database Insertion** - Using SQL scripts for bulk creation

## Programmatic User Creation (TypeScript)

### Basic User Creation Script

```typescript
import { ensureDbConnection } from "@/wab/server/db/DbCon";
import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
import { spawn } from "@/wab/shared/common";

async function createUser() {
  // Database connection
  const dbUri = process.env.DATABASE_URI || "postgresql://wab@localhost/wab";
  const dbName = process.env.WAB_DBNAME || "wab";

  // For production with SSL
  // process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  console.log(`Connecting to database: ${dbName}`);
  const con = await ensureDbConnection(dbUri, dbName);

  try {
    await con.transaction(async (em) => {
      const db = new DbMgr(em, SUPER_USER);

      const email = "user@example.com";

      // Check if user already exists
      const existingUser = await db.tryGetUserByEmail(email);
      if (existingUser) {
        console.log(`User ${email} already exists!`);
        return;
      }

      // Create the user
      const user = await db.createUser({
        email: email,
        firstName: "John",
        lastName: "Doe",
        password: "securePassword123", // Will be hashed automatically
        needsIntroSplash: false, // Skip intro tutorial
        needsSurvey: false, // Skip survey
        needsTeamCreationPrompt: false, // Skip team creation prompt
      });

      // Mark email as verified (optional - skip email verification)
      await db.markEmailAsVerified(user);

      console.log(`✅ User created successfully!`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Personal Team ID: ${user.personalTeamId}`);
    });
  } catch (error) {
    console.error("Error during user creation:", error);
    throw error;
  }

  process.exit(0);
}

if (require.main === module) {
  spawn(createUser());
}
```

### Running the Script

```bash
# Development
WAB_DBNAME=wab npm run run-ts -- create-user.ts

# Production (with appropriate DATABASE_URI)
DATABASE_URI="postgresql://user:pass@host:port/db?sslmode=require" \
WAB_DBNAME=wab npm run run-ts -- create-user.ts
```

### CreateUser Options

The `db.createUser()` method accepts these parameters:

```typescript
interface CreateUserOptions {
  email: string; // Required: User email
  password?: string; // Optional: Plain text password (will be hashed)
  firstName?: string; // Optional: First name
  lastName?: string; // Optional: Last name
  avatarUrl?: string | null; // Optional: Profile picture URL
  needsIntroSplash?: boolean; // Default: true - Show intro tutorial
  needsSurvey?: boolean; // Default: true - Show survey
  needsTeamCreationPrompt?: boolean; // Default: true - Prompt to create team
  isWhiteLabel?: boolean; // Default: false - White label user
  whiteLabelId?: string; // White label identifier
  whiteLabelInfo?: Record<string, any>; // White label metadata
  owningTeamId?: TeamId; // For white label users
  signUpPromotionCode?: PromotionCode; // Promotion code used
  id?: UserId; // Optional: Specific user ID
  orgId?: string; // Optional: Organization ID
}
```

## Direct Database Creation (SQL)

For bulk user creation or when TypeScript environment is not available:

```sql
-- Create user with all required fields
DO $$
DECLARE
    user_id TEXT := 'user_' || extract(epoch from now())::bigint;
    team_id TEXT := 'team_' || extract(epoch from now())::bigint;
    workspace_id TEXT := 'ws_' || extract(epoch from now())::bigint;
    perm_id TEXT := 'perm_' || extract(epoch from now())::bigint;
BEGIN
    -- 1. Insert user
    INSERT INTO "user" (
        id,
        email,
        bcrypt,  -- Password hash (use bcrypt with cost factor 10)
        "firstName",
        "lastName",
        "needsSurvey",
        "needsIntroSplash",
        "waitingEmailVerification",
        "needsTeamCreationPrompt",
        "createdAt",
        "updatedAt"
    )
    VALUES (
        user_id,
        'user@example.com',
        '$2b$10$...', -- Generate using bcrypt
        'John',
        'Doe',
        false,  -- Skip survey
        false,  -- Skip intro
        false,  -- Email verified
        false,  -- Skip team prompt
        NOW(),
        NOW()
    );

    -- 2. Create personal team
    INSERT INTO team (
        id,
        name,
        "billingEmail",
        "personalTeamOwnerId",
        "createdAt",
        "updatedAt"
    )
    VALUES (
        team_id,
        'Personal team',
        'user@example.com',
        user_id,
        NOW(),
        NOW()
    );

    -- 3. Create personal workspace
    INSERT INTO workspace (
        id,
        name,
        description,
        "teamId",
        "createdAt",
        "updatedAt"
    )
    VALUES (
        workspace_id,
        'Personal workspace',
        'Personal workspace',
        team_id,
        NOW(),
        NOW()
    );

    -- 4. Grant owner permission
    INSERT INTO permission (
        id,
        "teamId",
        "userId",
        "accessLevel",
        "createdAt",
        "updatedAt"
    )
    VALUES (
        perm_id,
        team_id,
        user_id,
        'owner',
        NOW(),
        NOW()
    );

    RAISE NOTICE 'User created with ID: %', user_id;
END $$;
```

### Generating Password Hashes

To generate bcrypt hashes for SQL scripts:

```typescript
import bcrypt from "bcryptjs";

const password = "yourPassword123";
const hash = bcrypt.hashSync(password, 10);
console.log(hash); // Use this in the SQL script
```

Or using command line:

```bash
# Using Node.js
node -e "console.log(require('bcryptjs').hashSync('yourPassword123', 10))"

# Using Python
python -c "import bcrypt; print(bcrypt.hashpw(b'yourPassword123', bcrypt.gensalt()).decode())"
```

## User Verification

### Check if User Exists

```typescript
async function checkUser(email: string) {
  const con = await ensureDbConnection(dbUri, dbName);

  await con.transaction(async (em) => {
    const db = new DbMgr(em, SUPER_USER);

    const user = await db.tryGetUserByEmail(email);

    if (user) {
      console.log("✅ User found!");
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Name: ${user.firstName} ${user.lastName}`);
      console.log(`   Email Verified: ${!user.waitingEmailVerification}`);
      console.log(`   Created: ${user.createdAt}`);

      // Get teams
      const teams = await db.getTeamsByUserId(user.id);
      console.log(`\n   Teams (${teams.length}):`);
      for (const team of teams) {
        console.log(`     - ${team.name} (${team.id})`);
        if (team.personalTeamOwnerId === user.id) {
          console.log(`       ^ Personal team`);
        }
      }
    } else {
      console.log("❌ User not found!");
    }
  });
}
```

## Best Practices

### 1. Password Security

- Use strong passwords (minimum 12 characters)
- Never commit passwords to version control
- Consider using environment variables for sensitive data
- Use password managers to generate secure passwords

### 2. Email Verification

- For production users, allow email verification process
- Only skip verification for test/development accounts
- Use `db.markEmailAsVerified()` judiciously

### 3. User Onboarding

- Set `needsIntroSplash`, `needsSurvey`, and `needsTeamCreationPrompt` based on user type
- Internal users may skip all onboarding
- New users benefit from tutorials

### 4. Database Transactions

- Always use transactions when creating users
- This ensures team, workspace, and permissions are created atomically
- Rollback on any error

### 5. Error Handling

- Check for existing users before creation
- Handle database connection errors gracefully
- Log sufficient information for debugging

## Common Issues

### 1. User Already Exists

```typescript
// Always check first
const existingUser = await db.tryGetUserByEmail(email);
if (existingUser) {
  console.log("User already exists");
  return;
}
```

### 2. SSL Certificate Issues (Production)

```typescript
// For self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
```

### 3. Missing Personal Team

The `createUser` method automatically creates:

- Personal team (owned by the user)
- Personal workspace (in the personal team)
- Owner permission for the team

### 4. Password Hash Issues

- Ensure bcrypt hash is properly formatted
- Use cost factor 10 (Plasmic default)
- Test password works before bulk creation

## Script Templates

### Development User Creation

```bash
# Save as: create-dev-user.ts
# Run: WAB_DBNAME=wab npm run run-ts -- create-dev-user.ts
```

### Production User Creation

```bash
# Save as: create-prod-user.ts
# Run: DATABASE_URI="..." WAB_DBNAME=wab npm run run-ts -- create-prod-user.ts
```

### Bulk User Creation

```bash
# Save as: create-bulk-users.ts
# Read from CSV/JSON and create multiple users
```
