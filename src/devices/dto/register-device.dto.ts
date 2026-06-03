import { DevicePlatform, PushPlatform } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiPropertyOptional({ description: 'Existing client-known device id for update.' })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  identityPublicKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pushToken?: string;

  @ApiPropertyOptional({ enum: PushPlatform })
  @IsOptional()
  @IsEnum(PushPlatform)
  // FCM is the only currently-shipping provider; APNS/HMS values are reserved.
  // iOS clients must register with pushPlatform='FCM' (FCM bridges to APNS).
  pushPlatform?: PushPlatform;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pushActive?: boolean;
}
