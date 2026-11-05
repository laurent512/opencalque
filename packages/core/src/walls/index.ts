/*
 * Walls (ARCHITECTURE §4, "Walls"). A wall is its line and a thickness; everything else about it is
 * worked out from where it is: its corners, its doors and windows, the rooms it bounds.
 *
 *   course    the line a wall follows, straight or curved, and what is measured along and across it
 *   spatial   the indexes of wall ends and walls, made once for each state of the drawing
 *   openings  doors and windows: which wall each is in, and putting one on a wall
 *   joints    corners: how the faces of walls that meet are brought together, and the corner as a place
 *   outline   what a wall draws: its pieces, the lines across its ends, which lines are shown
 *   seams     the lines between walls of different materials, drawn over the walls
 *   edit      changes that keep the plan in one piece: following a move, thickness, splitting, extending
 *   follow    doors and windows put back in the wall an edit changed
 */
export { bulgeThrough, distToWall, wallArc, wallContains, wallLength, wallMiddle, wallParallel, wallPoints, wallSides, wallSpot, type WallArc } from './course'
export { autoJoinCuts, connectedWalls, cornerJoin, cornerJoinOps, looseEndOps, moveCornerOps, NEAR_JOIN, wallEndState, wallEndsAt, wallEndsOf, type NearEnd, type WallEnd, type WallJoin } from './joints'
export { hostWall, openingSpan, snapOpeningToWall, wallOpenings } from './openings'
export { openingFollowOps } from './follow'
export { endLineOps, endLineShown, endLineUsual, wallEdgeLines, wallOutline, wallOutlineRuns, wallParts, wallPolygons, wallSeams, withEdge, type WallPiece, type WallParts } from './outline'
export type { Stop } from './joints'
export { materialSeams } from './seams'
export { extendWallOps, flipWallOps, splitWallOps, trimWallOps, wallEndFollowOps, wallFollowOps, wallJustifyOps, wallThicknessOps } from './edit'
