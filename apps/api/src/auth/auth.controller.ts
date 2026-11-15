import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import type { AuthenticatedUser } from "./auth.types";

interface LoginBody {
  email?: string;
  password?: string;
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body() body: LoginBody) {
    if (!body.email || !body.password) {
      throw new BadRequestException("email and password are required");
    }
    return this.authService.login(body.email, body.password);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
