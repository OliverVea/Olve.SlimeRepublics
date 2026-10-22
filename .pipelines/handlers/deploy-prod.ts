import { implement } from "@olve/pipelines";
import { deployProd } from "../pipeline";
import { deploy } from "./lib/deploy";

export default implement(deployProd, (input, ctx) => deploy(ctx, input, "apps"));
