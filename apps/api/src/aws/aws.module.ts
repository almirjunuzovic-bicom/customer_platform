import { Module } from "@nestjs/common";
import { AwsLightsailService } from "./aws.service";

@Module({
  providers: [AwsLightsailService],
  exports: [AwsLightsailService],
})
export class AwsModule {}
