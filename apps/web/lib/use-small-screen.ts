"use client";
import { useMediaQuery } from "./use-media-query";
export const useSmallScreen = () => useMediaQuery("(max-width:600px)");
