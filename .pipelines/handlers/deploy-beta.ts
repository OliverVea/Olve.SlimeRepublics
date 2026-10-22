import { implement } from "@olve/pipelines";
import { deployBeta } from "../pipeline";
import { deploy } from "./lib/deploy";

export default implement(deployBeta, (input, ctx) => deploy(ctx, input, "apps-beta"));
