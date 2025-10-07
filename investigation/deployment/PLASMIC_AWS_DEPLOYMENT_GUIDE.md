# Plasmic WAB AWS ECS & RDS Deployment Guide

## Overview

This guide documents the complete process of deploying the Plasmic Web Application Builder (WAB) to AWS using:
- **Amazon ECS (Fargate)** for container orchestration
- **Amazon RDS PostgreSQL** for the database
- **Amazon ECR** for Docker image registry
- **Application Load Balancer** for traffic distribution

### Architecture Summary

The Plasmic WAB application consists of:
- **Frontend**: React application built with RSBuild (served on port 3003 in dev)
- **Backend**: Express.js API server (port 3004)
- **Database**: PostgreSQL 15
- **Optional**: Separate WebSocket server for real-time features

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running
- Access to the Plasmic repository
- Basic understanding of AWS services

## Step 1: Create RDS PostgreSQL Database

### 1.1 Set AWS Region
```bash
export AWS_DEFAULT_REGION=eu-west-1
```

### 1.2 Get VPC and Subnet Information
```bash
# Get default VPC
DEFAULT_VPC=$(aws ec2 describe-vpcs \
    --filters "Name=is-default,Values=true" \
    --query 'Vpcs[0].VpcId' \
    --output text)

# Get subnets in different availability zones
SUBNET1=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$DEFAULT_VPC" "Name=availability-zone,Values=eu-west-1a" \
    --query 'Subnets[0].SubnetId' \
    --output text)

SUBNET2=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$DEFAULT_VPC" "Name=availability-zone,Values=eu-west-1b" \
    --query 'Subnets[0].SubnetId' \
    --output text)
```

### 1.3 Create Database Infrastructure
```bash
# Create DB subnet group
aws rds create-db-subnet-group \
    --db-subnet-group-name plasmic-test-subnet-group \
    --db-subnet-group-description "Subnet group for Plasmic test database" \
    --subnet-ids $SUBNET1 $SUBNET2 \
    --tags Key=Environment,Value=test Key=Application,Value=plasmic

# Create security group for RDS
RDS_SG=$(aws ec2 create-security-group \
    --group-name plasmic-rds-test-sg \
    --description "Security group for Plasmic test RDS instance" \
    --vpc-id $DEFAULT_VPC \
    --query 'GroupId' \
    --output text)

# Allow PostgreSQL access
aws ec2 authorize-security-group-ingress \
    --group-id $RDS_SG \
    --protocol tcp \
    --port 5432 \
    --cidr 10.0.0.0/8  # Adjust based on your VPC CIDR
```

### 1.4 Create RDS Instance
```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
    --db-instance-identifier plasmic-test-db \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version 15.4 \
    --master-username plasmicadmin \
    --master-user-password "YourSecurePassword123!" \
    --allocated-storage 20 \
    --storage-type gp3 \
    --storage-encrypted \
    --vpc-security-group-ids $RDS_SG \
    --db-subnet-group-name plasmic-test-subnet-group \
    --backup-retention-period 7 \
    --preferred-backup-window "03:00-04:00" \
    --preferred-maintenance-window "sun:04:00-sun:05:00" \
    --no-multi-az \
    --no-publicly-accessible \
    --enable-cloudwatch-logs-exports postgresql \
    --tags Key=Environment,Value=test Key=Application,Value=plasmic

# Wait for instance to be available
aws rds wait db-instance-available \
    --db-instance-identifier plasmic-test-db

# Get the endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier plasmic-test-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)
```

## Step 2: Build and Push Docker Image

### 2.1 Create ECR Repository
```bash
# Create ECR repository
aws ecr create-repository \
    --repository-name plasmic-wab \
    --region eu-west-1 \
    --image-tag-mutability MUTABLE \
    --image-scanning-configuration scanOnPush=true

# Get repository URI
ECR_URI=$(aws ecr describe-repositories \
    --repository-names plasmic-wab \
    --region eu-west-1 \
    --query 'repositories[0].repositoryUri' \
    --output text)
```

### 2.2 Build Docker Image
```bash
# Navigate to platform directory (important!)
cd /path/to/plasmic/platform

# Create .dockerignore to reduce build context
cat > .dockerignore << 'EOF'
**/node_modules
**/.yarn
**/build
**/dist
**/.next
**/coverage
**/.env
**/.git
**/docs
**/*.md
EOF

# Build the Docker image
docker build \
    -f wab/Dockerfile \
    -t plasmic-wab:latest \
    --platform linux/amd64 \
    .
```

### 2.3 Push to ECR
```bash
# Login to ECR
aws ecr get-login-password --region eu-west-1 | \
    docker login --username AWS --password-stdin ${ECR_URI%/*}

# Tag and push
docker tag plasmic-wab:latest $ECR_URI:latest
docker tag plasmic-wab:latest $ECR_URI:$(git rev-parse --short HEAD)

docker push $ECR_URI:latest
docker push $ECR_URI:$(git rev-parse --short HEAD)
```

## Step 3: Create ECS Task Definition

### 3.1 Create IAM Roles
```bash
# Create task execution role
aws iam create-role \
    --role-name plasmic-ecs-task-execution-role \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ecs-tasks.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }'

# Attach policies
aws iam attach-role-policy \
    --role-name plasmic-ecs-task-execution-role \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

aws iam attach-role-policy \
    --role-name plasmic-ecs-task-execution-role \
    --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

### 3.2 Create CloudWatch Log Group
```bash
aws logs create-log-group \
    --log-group-name /ecs/plasmic-wab \
    --region eu-west-1
```

### 3.3 Create Task Definition
```bash
# Create task definition file
cat > plasmic-task-definition.json << EOF
{
  "family": "plasmic-wab",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/plasmic-ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "plasmic-wab",
      "image": "$ECR_URI:latest",
      "portMappings": [
        {"containerPort": 3004, "protocol": "tcp"}
      ],
      "essential": true,
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "HOST", "value": "https://your-domain.com"},
        {"name": "DATABASE_URI", "value": "postgresql://plasmicadmin:YourSecurePassword123!@$RDS_ENDPOINT:5432/wab"},
        {"name": "SESSION_SECRET", "value": "your-secure-session-secret"},
        {"name": "MAIL_CONFIG", "value": "{\"mailFrom\":\"Plasmic <noreply@yourdomain.com>\",\"mailUserOps\":\"ops@yourdomain.com\"}"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/plasmic-wab",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3004/healthcheck || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
EOF

# Register task definition
aws ecs register-task-definition \
    --cli-input-json file://plasmic-task-definition.json \
    --region eu-west-1
```

## Step 4: Deploy Infrastructure

### 4.1 Create ECS Cluster
```bash
aws ecs create-cluster \
    --cluster-name plasmic-test-cluster \
    --region eu-west-1 \
    --capacity-providers FARGATE FARGATE_SPOT
```

### 4.2 Setup VPC Networking
```bash
# Create Internet Gateway (if needed)
IGW_ID=$(aws ec2 create-internet-gateway \
    --region eu-west-1 \
    --query 'InternetGateway.InternetGatewayId' \
    --output text)

# Attach to VPC
aws ec2 attach-internet-gateway \
    --internet-gateway-id $IGW_ID \
    --vpc-id $DEFAULT_VPC

# Update route table
ROUTE_TABLE_ID=$(aws ec2 describe-route-tables \
    --filters "Name=vpc-id,Values=$DEFAULT_VPC" "Name=association.main,Values=true" \
    --query 'RouteTables[0].RouteTableId' \
    --output text)

aws ec2 create-route \
    --route-table-id $ROUTE_TABLE_ID \
    --destination-cidr-block 0.0.0.0/0 \
    --gateway-id $IGW_ID
```

### 4.3 Create Security Groups
```bash
# ALB Security Group
ALB_SG=$(aws ec2 create-security-group \
    --group-name plasmic-alb-sg \
    --description "Security group for Plasmic ALB" \
    --vpc-id $DEFAULT_VPC \
    --query 'GroupId' \
    --output text)

aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0

# ECS Security Group
ECS_SG=$(aws ec2 create-security-group \
    --group-name plasmic-ecs-sg \
    --description "Security group for Plasmic ECS tasks" \
    --vpc-id $DEFAULT_VPC \
    --query 'GroupId' \
    --output text)

aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG \
    --protocol tcp \
    --port 3004 \
    --source-group $ALB_SG

# Allow ECS to RDS
aws ec2 authorize-security-group-ingress \
    --group-id $RDS_SG \
    --protocol tcp \
    --port 5432 \
    --source-group $ECS_SG
```

### 4.4 Create Application Load Balancer
```bash
# Create ALB
ALB_ARN=$(aws elbv2 create-load-balancer \
    --name plasmic-test-alb \
    --subnets $SUBNET1 $SUBNET2 \
    --security-groups $ALB_SG \
    --region eu-west-1 \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text)

# Create target group
TG_ARN=$(aws elbv2 create-target-group \
    --name plasmic-tg \
    --protocol HTTP \
    --port 3004 \
    --vpc-id $DEFAULT_VPC \
    --target-type ip \
    --health-check-path /healthcheck \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)

# Create listener
aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn=$TG_ARN
```

### 4.5 Create ECS Service
```bash
aws ecs create-service \
    --cluster plasmic-test-cluster \
    --service-name plasmic-wab-service \
    --task-definition plasmic-wab:1 \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={
        subnets=[$SUBNET1,$SUBNET2],
        securityGroups=[$ECS_SG],
        assignPublicIp=ENABLED
    }" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=plasmic-wab,containerPort=3004" \
    --region eu-west-1

# Wait for service to be stable
aws ecs wait services-stable \
    --cluster plasmic-test-cluster \
    --services plasmic-wab-service \
    --region eu-west-1
```

## Step 5: Run Database Migrations

### 5.1 Create Migration Task
```bash
# Create migration task definition
cat > plasmic-migration-task.json << EOF
{
  "family": "plasmic-wab-migration",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/plasmic-ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "plasmic-migration",
      "image": "$ECR_URI:latest",
      "command": ["node", "-r", "esbuild-register", "src/wab/server/db/migrate.ts"],
      "essential": true,
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "DATABASE_URI", "value": "postgresql://plasmicadmin:YourSecurePassword123!@$RDS_ENDPOINT:5432/wab"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/plasmic-wab",
          "awslogs-region": "eu-west-1",
          "awslogs-stream-prefix": "migration"
        }
      }
    }
  ]
}
EOF

# Register and run migration
aws ecs register-task-definition \
    --cli-input-json file://plasmic-migration-task.json \
    --region eu-west-1

aws ecs run-task \
    --cluster plasmic-test-cluster \
    --task-definition plasmic-wab-migration:1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={
        subnets=[$SUBNET1,$SUBNET2],
        securityGroups=[$ECS_SG],
        assignPublicIp=ENABLED
    }" \
    --region eu-west-1
```

## Environment Variables Reference

### Required Variables
- `NODE_ENV`: Set to "production"
- `HOST`: Your public domain (e.g., https://studio.yourdomain.com)
- `DATABASE_URI`: PostgreSQL connection string
- `SESSION_SECRET`: Secure random string for session encryption
- `MAIL_CONFIG`: JSON config for email settings

### Optional Variables
- `SENTRY_DSN`: For error tracking
- `AMPLITUDE_API_KEY`: For analytics
- `INTERCOM_APP_ID`: For customer support
- `POSTHOG_API_KEY`: For product analytics
- `STRIPE_PUBLISHABLE_KEY`: For payments
- `GENERIC_WORKER_POOL_SIZE`: Default 1
- `LOADER_WORKER_POOL_SIZE`: Default 1

## Troubleshooting

### Common Issues

1. **Docker build fails with "no space left on device"**
   - Clean Docker: `docker system prune -a --volumes -f`
   - Create `.dockerignore` file to exclude unnecessary files
   - Increase Docker disk allocation

2. **VPC has no internet gateway**
   - Create and attach an Internet Gateway to your VPC
   - Update route tables to route 0.0.0.0/0 to the IGW

3. **Task fails to start**
   - Check CloudWatch logs: `/ecs/plasmic-wab`
   - Verify security groups allow correct traffic
   - Ensure IAM roles have necessary permissions

4. **Database connection fails**
   - Verify RDS security group allows traffic from ECS
   - Check DATABASE_URI format and credentials
   - Ensure RDS is in the same VPC

### Monitoring

```bash
# Check service status
aws ecs describe-services \
    --cluster plasmic-test-cluster \
    --services plasmic-wab-service \
    --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# View logs
aws logs tail /ecs/plasmic-wab --follow

# Get ALB DNS
aws elbv2 describe-load-balancers \
    --names plasmic-test-alb \
    --query 'LoadBalancers[0].DNSName' \
    --output text
```

## Production Considerations

1. **Database**
   - Use Multi-AZ deployment for high availability
   - Enable automated backups
   - Consider read replicas for scaling

2. **ECS Service**
   - Configure auto-scaling policies
   - Use multiple tasks for redundancy
   - Enable container insights

3. **Security**
   - Use AWS Secrets Manager for sensitive values
   - Enable VPC Flow Logs
   - Configure WAF on ALB
   - Use SSL/TLS certificates

4. **Cost Optimization**
   - Use Fargate Spot for non-critical tasks
   - Right-size container resources
   - Enable S3 lifecycle policies for logs

## Cleanup

To remove all resources:
```bash
# Delete ECS service
aws ecs update-service \
    --cluster plasmic-test-cluster \
    --service plasmic-wab-service \
    --desired-count 0

aws ecs delete-service \
    --cluster plasmic-test-cluster \
    --service plasmic-wab-service

# Delete ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN
aws elbv2 delete-target-group --target-group-arn $TG_ARN

# Delete RDS (after final backup)
aws rds delete-db-instance \
    --db-instance-identifier plasmic-test-db \
    --final-db-snapshot-identifier plasmic-test-final-snapshot

# Delete security groups, subnet groups, etc.
```

## Outcome

Successfully deployed Plasmic WAB application to AWS with:
- ✅ RDS PostgreSQL database configured and running
- ✅ Docker image built and pushed to ECR
- ✅ ECS Fargate cluster with running tasks
- ✅ Application Load Balancer routing traffic
- ✅ Database migrations executed
- ✅ Application accessible via ALB DNS

The application is now running in a scalable, production-ready environment on AWS.