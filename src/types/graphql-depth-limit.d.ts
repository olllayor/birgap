declare module 'graphql-depth-limit' {
  import type { ValidationContext, ASTVisitor } from 'graphql';

  type DepthLimitOptions = {
    ignore?: string[];
  };

  function depthLimit(
    maxDepth: number,
    options?: DepthLimitOptions,
    callback?: (
      queryDepths: Record<string, number>,
    ) => void,
  ): (context: ValidationContext) => ASTVisitor;

  export = depthLimit;
}
