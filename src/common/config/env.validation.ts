import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  APP_ORIGIN: Joi.string().default('http://localhost:3000'),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(24).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(30),
  WEBSOCKET_TICKET_TTL_SECONDS: Joi.number().default(60),
  OTP_MODE: Joi.string().valid('mock').default('mock'),
  OTP_MOCK_CODE: Joi.string().default('000000'),
  OTP_TTL_SECONDS: Joi.number().default(300),
  MAX_ACTIVE_DEVICES: Joi.number().default(3),
  SIGNED_PREKEY_ROTATION_DAYS: Joi.number().default(7),
  PUSH_PROVIDER: Joi.string().valid('logger').default('logger'),
  FCM_PROJECT_ID: Joi.string().allow('').optional(),
  APNS_TEAM_ID: Joi.string().allow('').optional(),
  HMS_APP_ID: Joi.string().allow('').optional(),
});
