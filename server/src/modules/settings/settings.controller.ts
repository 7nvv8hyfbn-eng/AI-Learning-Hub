import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { PublishStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthGuard } from '../auth/auth.guard'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { BatchSettingsDto, CreateDepartmentDto, CreateNotificationDto, CreateSchoolDto, UpdateSettingDto } from './settings.dto'
import { SettingsService } from './settings.service'
import { RegistrationService } from '../auth/registration.service'
import { RegistrationSettingsInput } from '../auth/auth.dto'

@Controller('admin/settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}
  @Get() @Permissions('settings.read') list() { return this.settings.list() }
  @Patch() @Permissions('settings.write') update(@Body() input: UpdateSettingDto) { return this.settings.update(input) }
  @Patch('batch') @Permissions('settings.write') batch(@Body() input: BatchSettingsDto) { return this.settings.batch(input) }
}

@Controller('admin')
@UseGuards(AuthGuard, PermissionsGuard)
export class SettingsOperationsController {
  constructor(private readonly prisma: PrismaService, private readonly registration: RegistrationService) {}
  @Get('registration/settings') @Permissions('settings.read')
  registrationSettings() { return this.registration.configuration() }
  @Patch('registration/settings') @Permissions('settings.write')
  updateRegistration(@Body() input: RegistrationSettingsInput) { return this.registration.updateSettings(input) }
  @Get('schools') @Permissions('settings.read')
  schools() { return this.prisma.school.findMany({ include: { departments: { orderBy: { name: 'asc' } }, _count: { select: { users: true } } }, orderBy: { name: 'asc' } }) }
  @Post('schools') @Permissions('settings.write')
  school(@Body() input: CreateSchoolDto) { return this.prisma.school.create({ data: input }) }
  @Post('schools/:id/departments') @Permissions('settings.write')
  department(@Param('id') schoolId: string, @Body() input: CreateDepartmentDto) {
    return this.prisma.department.create({ data: { schoolId, ...input } })
  }
  @Get('notifications') @Permissions('settings.read')
  notifications() { return this.prisma.notification.findMany({ include: { _count: { select: { reads: true } } }, orderBy: { createdAt: 'desc' } }) }
  @Post('notifications') @Permissions('settings.write')
  notification(@Body() input: CreateNotificationDto) { return this.prisma.notification.create({ data: input }) }
  @Post('notifications/:id/publish') @Permissions('settings.write')
  publishNotification(@Param('id') id: string) {
    return this.prisma.notification.update({ where: { id }, data: { status: PublishStatus.published, publishedAt: new Date() } })
  }
  @Post('notifications/:id/archive') @Permissions('settings.write')
  archiveNotification(@Param('id') id: string) {
    return this.prisma.notification.update({ where: { id }, data: { status: PublishStatus.archived } })
  }
  @Get('audit-logs') @Permissions('settings.read')
  auditLogs() { return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }
  @Get('operation-logs') @Permissions('settings.read')
  operationLogs() { return this.prisma.operationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }
  @Get('login-logs') @Permissions('settings.read')
  loginLogs() {
    return this.prisma.loginLog.findMany({ select: { id: true, userId: true, identifier: true, result: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 })
  }
}
