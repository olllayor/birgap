import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Refresh token to revoke. Current session is revoked if omitted.' })
  @IsOptional()
  @IsString()
  @MinLength(20)
  refreshToken?: string;

  @ApiPropertyOptional({
    description:
      'Device to tear down with this logout. Deactivated in the same transaction as token revocation.',
  })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
