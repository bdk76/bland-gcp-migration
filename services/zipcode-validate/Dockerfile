# This Dockerfile is identical for all services
# Save this file as "Dockerfile" (no extension) in each service folder

# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Install dumb-init for proper signal handling
# This ensures graceful shutdowns when Cloud Run stops your container
RUN apk add --no-cache dumb-init

# Create app directory
WORKDIR /app

# Copy package files first for better caching
# Docker will cache this layer if package.json hasn't changed
COPY package*.json ./

# Install production dependencies only
# --production flag excludes devDependencies
# --frozen-lockfile ensures exact versions from package-lock.json
RUN npm ci --production && \
    npm cache clean --force

# Copy application code
COPY . .

# Create non-root user for security
# Running as root in production is a security risk
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Set production environment
ENV NODE_ENV=production

# Use dumb-init to handle signals properly
# This prevents zombie processes and ensures clean shutdown
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "index.js"]