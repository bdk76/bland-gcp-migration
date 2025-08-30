const express = require('express');
const cors = require('cors');
const { Firestore } = require('@google-cloud/firestore');
const NodeCache = require('node-cache');
const emailValidator = require('email-validator');

// Initialize services
const app = express();
const firestore = new Firestore();
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 }); // 10 min cache for email patterns

// Email provider patterns - cached for performance
const EMAIL_PROVIDERS = {
  common: {
    'gmail.com': ['gmail', 'googlemail'],
    'yahoo.com': ['yahoo', 'ymail', 'rocketmail'],
    'hotmail.com': ['hotmail', 'live', 'msn'],
    'outlook.com': ['outlook'],
    'aol.com': ['aol', 'aim'],
    'icloud.com': ['icloud', 'me', 'mac'],
    'protonmail.com': ['protonmail', 'proton', 'pm'],
    'yandex.com': ['yandex'],
    'mail.com': ['mail'],
    'zoho.com': ['zoho']
  },
  // Speech-to-text patterns that need special handling
  speechPatterns: {
    'atgmaildotcom': '@gmail.com',
    'atyahoodotcom': '@yahoo.com',
    'athotmaildotcom': '@hotmail.com',
    'atoutlookdotcom': '@outlook.com',
    'ataoldotcom': '@aol.com',
    'aticlouddotcom': '@icloud.com',
    'atprotonmaildotcom': '@protonmail.com',
    'atyandexdotcom': '@yandex.com',
    'atmaildotcom': '@mail.com',
    'atlivedotcom': '@live.com',
    'atmsdotcom': '@msn.com'
  },
  // Common typos and their corrections
  typoCorrections: {
    'gmai': 'gmail', 'gmial': 'gmail', 'gmil': 'gmail',
    'yaho': 'yahoo', 'yhoo': 'yahoo', 'yahooo': 'yahoo',
    'hotmai': 'hotmail', 'hotmal': 'hotmail', 'hotmial': 'hotmail',
    'outlok': 'outlook', 'outlokk': 'outlook', 'outloook': 'outlook',
    'icoud': 'icloud', 'iclud': 'icloud', 'icloude': 'icloud'
  }
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || 
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'email-validate',
    cache_entries: cache.keys().length
  });
});

// Warmup endpoint
app.get('/_ah/warmup', (req, res) => {
  // Pre-populate common patterns in cache
  cache.set('providers', EMAIL_PROVIDERS, 3600);
  res.status(200).send('OK');
});

// Main email validation endpoint
app.post('/api/enhanced-email-capture', async (req, res) => {
  const startTime = Date.now();
  const { requestId } = req;
  
  try {
    const {
      raw_email_input,
      attempt_number = 1,
      previous_attempts = [],
      validation_level = 'standard' // 'standard', 'strict', 'loose'
    } = req.body;
    
    console.log(`[${requestId}] Email validation request:`, {
      attempt: attempt_number,
      previous_attempts_count: previous_attempts.length,
      validation_level
    });
    
    // Step 1: Clean and normalize input using advanced patterns
    const cleanedInput = await cleanEmailInput(raw_email_input, requestId);
    
    // Step 2: Parse email components
    const parsedEmail = parseEmailComponents(cleanedInput);
    
    // Step 3: Check cache for known valid/invalid patterns
    const cacheKey = `email:${cleanedInput}`;
    const cachedValidation = cache.get(cacheKey);
    
    if (cachedValidation && attempt_number === 1) {
      console.log(`[${requestId}] Cache hit for email validation`);
      return res.json({
        ...cachedValidation,
        cached: true,
        response_time: Date.now() - startTime
      });
    }
    
    // Step 4: Validate and suggest corrections
    const validationResult = await validateAndSuggest(
      parsedEmail,
      previous_attempts,
      validation_level,
      requestId
    );
    
    // Step 5: Generate response
    const response = generateResponse(validationResult, attempt_number);
    
    // Cache successful validations
    if (response.type === 'success' && response.confidence === 'high') {
      cache.set(cacheKey, response, 3600); // Cache for 1 hour
    }
    
    // Log validation attempt for analytics (async, non-blocking)
    logValidationAttempt(requestId, raw_email_input, response).catch(err =>
      console.error(`[${requestId}] Failed to log validation:`, err)
    );
    
    res.json({
      ...response,
      response_time: Date.now() - startTime
    });
    
  } catch (error) {
    console.error(`[${requestId}] Email validation error:`, error);
    res.status(500).json({
      type: 'error',
      error: 'Failed to process email',
      message: error.message,
      requestId,
      response_time: Date.now() - startTime
    });
  }
});

// Helper Functions

async function cleanEmailInput(input, requestId) {
  if (!input) return '';
  
  let cleaned = input.toString().trim().toLowerCase();
  console.log(`[${requestId}] Cleaning input: "${cleaned}"`);
  
  // Remove all whitespace
  cleaned = cleaned.replace(/\s+/g, '');
  
  // Get speech patterns from cache or defaults
  const patterns = cache.get('providers') || EMAIL_PROVIDERS;
  
  // Apply speech-to-text pattern fixes FIRST (critical for Bland.ai)
  for (const [pattern, replacement] of Object.entries(patterns.speechPatterns)) {
    if (cleaned.includes(pattern)) {
      cleaned = cleaned.replace(new RegExp(pattern, 'g'), replacement);
      console.log(`[${requestId}] Applied speech pattern: ${pattern} -> ${replacement}`);
    }
  }
  
  // Only apply generic replacements if @ is still missing
  if (!cleaned.includes('@')) {
    // Handle "at" -> "@" conversion
    cleaned = cleaned.replace(/\bat\b/g, '@');
    cleaned = cleaned.replace(/at(?=[a-z]+\.(com|net|org|edu))/g, '@');
  }
  
  // Handle "dot" -> "." but be careful not to over-replace
  if (!cleaned.includes('.')) {
    cleaned = cleaned.replace(/dot(?=com|net|org|edu|gov|io)/g, '.');
    cleaned = cleaned.replace(/\bdot\b/g, '.');
  }
  
  // Handle underscores and dashes
  cleaned = cleaned.replace(/underscore/g, '_');
  cleaned = cleaned.replace(/dash|minus/g, '-');
  
  // Apply typo corrections for domain parts
  for (const [typo, correction] of Object.entries(patterns.typoCorrections)) {
    const regex = new RegExp(`@${typo}\\b`, 'g');
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, `@${correction}`);
      console.log(`[${requestId}] Corrected typo: ${typo} -> ${correction}`);
    }
  }
  
  // Handle incomplete domains
  if (cleaned.includes('@')) {
    const parts = cleaned.split('@');
    if (parts.length === 2) {
      const [local, domain] = parts;
      
      // Check if domain needs completion
      if (!domain.includes('.')) {
        // Try to match common providers
        for (const [fullDomain, aliases] of Object.entries(patterns.common)) {
          if (aliases.includes(domain) || domain === fullDomain.split('.')[0]) {
            cleaned = `${local}@${fullDomain}`;
            console.log(`[${requestId}] Completed domain: ${domain} -> ${fullDomain}`);
            break;
          }
        }
      }
    }
  }
  
  // Clean up any double symbols
  cleaned = cleaned.replace(/@@+/g, '@');
  cleaned = cleaned.replace(/\.\.+/g, '.');
  cleaned = cleaned.replace(/^[@.]|[@.]$/g, ''); // Remove leading/trailing @ or .
  
  return cleaned;
}

function parseEmailComponents(email) {
  const parts = email.split('@');
  
  return {
    local: parts[0] || '',
    domain: parts[1] || '',
    full_email: email,
    is_valid_format: parts.length === 2 && parts[0].length > 0 && parts[1].length > 0,
    has_at: email.includes('@'),
    has_dot_in_domain: parts[1] ? parts[1].includes('.') : false,
    part_count: parts.length
  };
}

async function validateAndSuggest(parsedEmail, previousAttempts, validationLevel, requestId) {
  const { local, domain, full_email, is_valid_format } = parsedEmail;
  
  // Check if this was already attempted
  const wasAttempted = previousAttempts.includes(full_email);
  
  // Basic format check
  if (!is_valid_format) {
    return {
      is_valid: false,
      confidence: 'low',
      needs_clarification: true,
      clarification_type: !parsedEmail.has_at ? 'missing_at_symbol' : 'format_issue',
      was_attempted: wasAttempted,
      parsed_email: full_email,
      suggestions: []
    };
  }
  
  // Validate local part
  const localValidation = validateLocalPart(local, validationLevel);
  
  // Validate domain
  const domainValidation = await validateDomain(domain, requestId);
  
  // Use email-validator for final check
  const isValidEmail = emailValidator.validate(full_email);
  
  // Determine confidence
  let confidence = 'low';
  if (isValidEmail && localValidation.valid && domainValidation.valid) {
    confidence = 'high';
  } else if (isValidEmail) {
    confidence = 'medium';
  }
  
  // Collect all suggestions
  const suggestions = [
    ...localValidation.suggestions,
    ...domainValidation.suggestions
  ];
  
  return {
    is_valid: isValidEmail,
    confidence,
    suggestions,
    needs_clarification: !isValidEmail || confidence === 'low',
    clarification_type: isValidEmail ? 'suggestions_only' : 'validation_failed',
    was_attempted: wasAttempted,
    parsed_email: full_email,
    local_validation: localValidation,
    domain_validation: domainValidation
  };
}

function validateLocalPart(local, validationLevel) {
  const suggestions = [];
  let valid = true;
  
  // Length checks
  if (local.length < 1) {
    suggestions.push({
      type: 'local_too_short',
      message: 'Email username is missing'
    });
    valid = false;
  } else if (local.length < 2 && validationLevel !== 'loose') {
    suggestions.push({
      type: 'local_very_short',
      message: 'Email username seems too short'
    });
  }
  
  if (local.length > 64) {
    suggestions.push({
      type: 'local_too_long',
      message: 'Email username exceeds maximum length (64 characters)'
    });
    valid = false;
  }
  
  // Character validation
  if (validationLevel !== 'loose') {
    const invalidChars = local.match(/[^a-zA-Z0-9._%+-]/g);
    if (invalidChars) {
      suggestions.push({
        type: 'invalid_characters',
        message: `Invalid characters found: ${invalidChars.join(', ')}`,
        valid_pattern: 'Letters, numbers, dots, underscores, plus signs, and hyphens only'
      });
      valid = false;
    }
  }
  
  // Check for consecutive dots
  if (local.includes('..')) {
    suggestions.push({
      type: 'consecutive_dots',
      message: 'Email username contains consecutive dots'
    });
    if (validationLevel === 'strict') valid = false;
  }
  
  // Check start/end characters
  if (local.startsWith('.') || local.endsWith('.')) {
    suggestions.push({
      type: 'dot_position',
      message: 'Email username cannot start or end with a dot'
    });
    if (validationLevel !== 'loose') valid = false;
  }
  
  return { valid, suggestions };
}

async function validateDomain(domain, requestId) {
  const suggestions = [];
  let valid = true;
  
  // Check for common providers from cache
  const providers = cache.get('providers') || EMAIL_PROVIDERS;
  
  // Check if domain has TLD
  if (!domain.includes('.')) {
    // Try to match common provider
    let matched = false;
    for (const [fullDomain, aliases] of Object.entries(providers.common)) {
      if (aliases.includes(domain) || domain === fullDomain.split('.')[0]) {
        suggestions.push({
          type: 'missing_tld',
          message: `Did you mean ${fullDomain}?`,
          correction: fullDomain,
          confidence: 'high'
        });
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      suggestions.push({
        type: 'unknown_domain',
        message: `Unknown domain: "${domain}". Please provide complete domain (e.g., gmail.com)`,
        needs_spelling: true
      });
    }
    valid = false;
  } else {
    // Validate domain format
    const domainParts = domain.split('.');
    const tld = domainParts[domainParts.length - 1];
    
    // Check TLD length
    if (tld.length < 2) {
      suggestions.push({
        type: 'invalid_tld',
        message: 'Invalid domain extension'
      });
      valid = false;
    }
    
    // Check for known typos
    const baseDomain = domainParts[0];
    for (const [typo, correction] of Object.entries(providers.typoCorrections)) {
      if (baseDomain === typo) {
        suggestions.push({
          type: 'domain_typo',
          message: `Did you mean ${correction}.${domainParts.slice(1).join('.')}?`,
          correction: `${correction}.${domainParts.slice(1).join('.')}`,
          confidence: 'high'
        });
      }
    }
  }
  
  // DNS validation (optional, for strict mode)
  if (valid && domain.includes('.')) {
    const dnsCacheKey = `dns:${domain}`;
    const dnsCache = cache.get(dnsCacheKey);
    
    if (dnsCache !== undefined) {
      valid = dnsCache;
    } else {
      // Note: In production, you might want to do actual DNS lookup
      // For now, we'll accept known domains
      const knownDomains = Object.keys(providers.common);
      const isKnown = knownDomains.includes(domain);
      cache.set(dnsCacheKey, isKnown, 3600);
      
      if (!isKnown && domain.split('.').length === 2) {
        suggestions.push({
          type: 'uncommon_domain',
          message: 'This appears to be an uncommon email domain',
          confidence: 'low'
        });
      }
    }
  }
  
  return { valid, suggestions };
}

function generateResponse(validationResult, attemptNumber) {
  const {
    is_valid,
    confidence,
    suggestions,
    needs_clarification,
    clarification_type,
    was_attempted,
    parsed_email,
    local_validation,
    domain_validation
  } = validationResult;
  
  // High confidence success
  if (is_valid && confidence === 'high' && !was_attempted) {
    return {
      type: 'success',
      email: parsed_email,
      confidence: 'high',
      message: 'Email captured successfully',
      needs_confirmation: false
    };
  }
  
  // Medium confidence - needs confirmation
  if (is_valid && confidence === 'medium') {
    return {
      type: 'success_with_suggestions',
      email: parsed_email,
      confidence: 'medium',
      message: 'Email captured, but please confirm',
      suggestions: suggestions,
      needs_confirmation: true,
      confirmation_prompt: generateConfirmationPrompt(parsed_email, suggestions)
    };
  }
  
  // Already attempted
  if (was_attempted && attemptNumber > 2) {
    return {
      type: 'already_attempted',
      email: parsed_email,
      confidence: 'low',
      message: 'This email was already tried. Please spell it out slowly or try a different email.',
      needs_confirmation: false,
      suggestion: 'Try spelling: "J-O-H-N at G-M-A-I-L dot C-O-M"'
    };
  }
  
  // Needs clarification
  if (needs_clarification) {
    return {
      type: 'needs_clarification',
      email: parsed_email || null,
      confidence: 'low',
      message: 'Please clarify your email address',
      suggestions: suggestions,
      clarification_prompt: generateClarificationPrompt(
        clarification_type,
        suggestions,
        attemptNumber
      ),
      needs_confirmation: false
    };
  }
  
  // Default error
  return {
    type: 'error',
    email: null,
    confidence: 'low',
    message: 'Unable to process email. Please try again.',
    needs_confirmation: false
  };
}

function generateConfirmationPrompt(email, suggestions) {
  let prompt = `I have your email as ${email}. `;
  
  if (suggestions.length > 0) {
    const suggestion = suggestions[0];
    if (suggestion.correction) {
      prompt += `Did you mean ${suggestion.correction}? `;
    }
  }
  
  prompt += `Please confirm if this is correct, or provide your email again.`;
  return prompt;
}

function generateClarificationPrompt(clarificationType, suggestions, attemptNumber) {
  let prompt = '';
  
  if (attemptNumber === 1) {
    prompt = 'I want to make sure I get your email address exactly right. ';
  } else {
    prompt = "Let's try to get your email address again. ";
  }
  
  switch (clarificationType) {
    case 'missing_at_symbol':
      prompt += 'Please say your email with "at" for @ and "dot" for the period. For example: "john at gmail dot com"';
      break;
    case 'format_issue':
      prompt += 'Please spell out your email slowly. For example: "J-O-H-N at gmail dot com"';
      break;
    case 'validation_failed':
      if (suggestions.length > 0 && suggestions[0].correction) {
        prompt += `Did you mean ${suggestions[0].correction}? If not, please spell your email slowly.`;
      } else {
        prompt += 'Please spell out your complete email address slowly, including the domain.';
      }
      break;
    default:
      prompt += 'Could you please repeat your email address?';
  }
  
  return prompt;
}

async function logValidationAttempt(requestId, input, result) {
  // Log to Firestore for analytics
  try {
    const logData = {
      requestId,
      timestamp: new Date(),
      input: input.substring(0, 100), // Truncate for privacy
      result_type: result.type,
      confidence: result.confidence,
      success: result.type === 'success'
    };
    
    // TODO: MIGRATION POINT - Add Firestore logging when ready
    console.log(`[${requestId}] Validation logged:`, logData);
  } catch (error) {
    console.error(`[${requestId}] Failed to log validation:`, error);
  }
}

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`Email validation service listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  
  // Pre-warm cache with common patterns
  cache.set('providers', EMAIL_PROVIDERS, 3600);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;