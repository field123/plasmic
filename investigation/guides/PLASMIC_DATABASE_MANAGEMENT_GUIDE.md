# Plasmic Database Management Guide

## Overview

Plasmic uses **TypeORM** with **PostgreSQL** for database management. This guide covers entity management, migrations, and the differences between development and production workflows.

## Table of Contents

1. [Database Architecture](#database-architecture)
2. [Entity Management](#entity-management)
3. [Migration Workflow](#migration-workflow)
4. [Development vs Production](#development-vs-production)
5. [Common Tasks](#common-tasks)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

## Database Architecture

### Technology Stack

- **ORM**: TypeORM 0.2.x
- **Database**: PostgreSQL 15+
- **Migration Tool**: TypeORM migrations
- **Configuration**: `ormconfig.json`

### Key Locations

```
platform/wab/
├── ormconfig.json                    # Database configuration
├── src/wab/server/
│   ├── db/
│   │   ├── DbCon.ts                 # Connection management
│   │   ├── DbMgr.ts                 # Database manager
│   │   └── DbInit.ts                # Seeding logic
│   ├── entities/
│   │   ├── Entities.ts              # Core entities
│   │   └── CustomEntities.ts        # Custom entity extensions
│   └── migrations/                   # Migration files
│       └── [timestamp]-[Name].ts
```

## Entity Management

### Base Entity Structure

All entities extend a base class that provides:

```typescript
abstract class Base<IdTag extends string> {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;

  @Column({ nullable: true })
  createdById: string | null;

  @Column({ nullable: true })
  updatedById: string | null;

  @Column({ nullable: true })
  deletedById: string | null;
}
```

### Creating a New Entity

1. **Add entity to `Entities.ts`**:

```typescript
import { Entity, Column, ManyToOne, Index } from "typeorm";

@Entity()
export class ElasticPathIntegration extends Base<"EPIntegrationId"> {
  @Column()
  name: string;

  @Column({ nullable: true })
  @Index() // Add indexes for frequently queried fields
  elasticPathOrgId: string | null;

  @ManyToOne(() => Team)
  team: Team;

  @Column()
  teamId: TeamId;

  @Column("jsonb", { nullable: true })
  config: {
    apiEndpoint: string;
    credentials: Record<string, any>;
  } | null;
}
```

2. **Add to entity exports**:

```typescript
// In Entities.ts
export * from "./ElasticPathIntegration";
```

3. **Generate migration**:

```bash
npm run typeorm -- migration:generate -n AddElasticPathIntegration
```

### Modifying an Existing Entity

1. **Make changes to the entity file**
2. **Generate a migration**:

```bash
npm run typeorm -- migration:generate -n UpdateElasticPathIntegration
```

3. **Review the generated migration** in `src/wab/server/migrations/`
4. **Run the migration** (happens automatically in dev)

### Removing an Entity

1. **Don't delete the entity file immediately**
2. **Create a migration to drop the table**:

```bash
npm run typeorm -- migration:create -n RemoveElasticPathIntegration
```

3. **Manually write the migration**:

```typescript
export class RemoveElasticPathIntegration1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "elastic_path_integration" CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the table structure for rollback
    await queryRunner.query(`
      CREATE TABLE "elastic_path_integration" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        -- other columns
      )
    `);
  }
}
```

## Migration Workflow

### Development Workflow

1. **Automatic migrations on startup**:
   - When you run `yarn dev`, migrations run automatically
   - Controlled by `maybeMigrateDatabase()` in `app-backend-real.ts`

2. **Manual migration commands**:

```bash
# Generate migration from entity changes
npm run typeorm -- migration:generate -n YourMigrationName

# Create empty migration
npm run typeorm -- migration:create -n YourMigrationName

# Run pending migrations
npm run typeorm -- migration:run

# Revert last migration
npm run typeorm -- migration:revert

# Show migration status
npm run typeorm -- migration:show
```

3. **Database reset (development only)**:

```bash
# Reset database and run all migrations
npm run db:reset

# Setup fresh database
npm run db:setup
```

### Production Workflow

1. **Migration Safety**:
   - Migrations use advisory locks to prevent concurrent execution
   - All migrations run in transactions
   - Automatic rollback on failure

2. **Deployment Process**:
   - Migrations run during container startup
   - Only one instance can run migrations at a time
   - Other instances wait for completion

3. **Manual Production Migration**:

```bash
# Connect to production database
DATABASE_URI=postgresql://user:pass@host/db npm run typeorm -- migration:run

# Always test in staging first!
```

## Development vs Production

### Key Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| Auto-migration | Yes (on startup) | Yes (with locks) |
| Connection Pool | Small (5-10) | Large (20-100) |
| Logging | Verbose | Minimal |
| Synchronize | Never (always false) | Never |
| Transactions | Optional | Required |
| Rollback | Easy | Careful planning |

### Environment-Specific Configuration

**Development** (`ormconfig.json`):
```json
{
  "type": "postgres",
  "host": "localhost",
  "port": 5432,
  "username": "wab",
  "password": "SEKRET",
  "database": "wab",
  "logging": ["query", "error"],
  "maxQueryExecutionTime": 1000
}
```

**Production** (via environment variables):
```bash
DATABASE_URI=postgresql://user:pass@host:5432/plasmic
DATABASE_POOL_SIZE=50
DATABASE_POOL_IDLE_TIMEOUT=10000
DATABASE_SSL=true
```

## Common Tasks

### Adding a New Table with Relations

```typescript
// 1. Create entity
@Entity()
export class StoreWorkspace extends Base<"StoreWorkspaceId"> {
  @Column()
  @Index()
  storeId: string;

  @ManyToOne(() => Workspace)
  workspace: Workspace;

  @Column()
  workspaceId: WorkspaceId;

  @Column("jsonb")
  storeMetadata: {
    locale: string;
    currency: string;
    timezone: string;
  };
}

// 2. Generate migration
npm run typeorm -- migration:generate -n AddStoreWorkspace

// 3. Migration runs automatically in dev
```

### Adding an Index to Existing Table

```bash
# Create migration
npm run typeorm -- migration:create -n AddIndexToUsers

# Edit migration file
```

```typescript
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE INDEX CONCURRENTLY "IDX_user_email_lower" 
    ON "user" (LOWER(email))
  `);
}

public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`DROP INDEX "IDX_user_email_lower"`);
}
```

### Data Migrations

For complex data transformations, use bundle migrations:

```typescript
// Create in src/wab/server/bundle-migrations/
export async function migrate(bundle: Bundle): Promise<Bundle> {
  // Transform data model
  return transformedBundle;
}
```

### Database Seeding

```bash
# Run seed script
npm run seed

# Custom seeding for specific data
npm run seed -- --org=elastic-path
```

## Best Practices

### 1. Migration Guidelines

- **Always generate migrations** from entity changes when possible
- **Test both up and down** migrations
- **Use transactions** for data consistency
- **Add indexes** for foreign keys and frequently queried fields
- **Include meaningful names** in migrations

### 2. Entity Design

- **Extend Base class** for standard fields
- **Use proper TypeORM decorators**
- **Add indexes strategically**
- **Use JSONB for flexible data**
- **Implement soft deletes** via deletedAt

### 3. Performance Considerations

```typescript
// Good: Indexed foreign key
@Column()
@Index()
teamId: TeamId;

// Good: Composite index for queries
@Index(["teamId", "createdAt"])

// Good: Partial index
@Index({ where: `"deletedAt" IS NULL` })
```

### 4. Safety Rules

- **Never use `synchronize: true`** in any environment
- **Always backup before major migrations**
- **Test migrations in staging first**
- **Keep migrations idempotent** when possible
- **Document breaking changes**

## Troubleshooting

### Common Issues

1. **Migration Lock Timeout**
```sql
-- Check for locks
SELECT * FROM pg_locks WHERE locktype = 'advisory';

-- Force release (use carefully)
SELECT pg_advisory_unlock_all();
```

2. **Failed Migration**
```bash
# Check migration status
npm run typeorm -- migration:show

# Manually revert if needed
npm run typeorm -- migration:revert
```

3. **Connection Pool Exhaustion**
```typescript
// Increase pool size in production
DATABASE_POOL_SIZE=100
```

4. **Slow Queries**
```sql
-- Enable query logging
ALTER DATABASE plasmic SET log_min_duration_statement = 1000;
```

### Migration Rollback Strategy

1. **Immediate Rollback**:
```bash
npm run typeorm -- migration:revert
```

2. **Restore from Backup**:
```bash
pg_restore -d plasmic backup.dump
```

3. **Forward Fix**:
- Create a new migration to fix issues
- Often safer than reverting in production

## Advanced Topics

### Custom Migration Runners

For complex migrations requiring application logic:

```typescript
// In migration file
import { getDbCon } from "../db/dbcon";
import { DbMgr } from "../db/DbMgr";

public async up(queryRunner: QueryRunner): Promise<void> {
  // Get application-level database access
  const con = await getDbCon();
  const mgr = new DbMgr(con, SUPER_USER);
  
  // Use application logic
  const teams = await mgr.getAllTeams();
  for (const team of teams) {
    await mgr.updateTeam(team.id, { 
      elasticPathEnabled: true 
    });
  }
}
```

### Database Maintenance

```bash
# Analyze tables for query optimization
npm run db:analyze

# Vacuum to reclaim space
npm run db:vacuum

# Reindex for performance
npm run db:reindex
```

## Conclusion

Plasmic's database management system provides a robust foundation for schema evolution and data integrity. Following these guidelines ensures smooth development and reliable production deployments. Always remember to test migrations thoroughly and maintain backward compatibility when possible.