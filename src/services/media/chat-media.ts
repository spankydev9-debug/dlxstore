// DLXSTORE — Chat Media Service
// Handles upload, processing, and display of chat media (images, videos, audio, documents)
// Includes emoji and sticker support

import { supabase } from "../db";
import { MediaType } from "../../types";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"];
const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface MediaFile {
  file: File;
  type: MediaType;
  previewUrl?: string;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    size: number;
    mimeType: string;
  };
}

export interface ProcessedMedia {
  media_type: MediaType;
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
}

export class ChatMediaService {
  static async validateFile(file: File): Promise<{ valid: boolean; error?: string }> {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` };
    }

    // Check file type
    const fileType = file.type;
    const isImage = ALLOWED_IMAGE_TYPES.includes(fileType);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(fileType);
    const isAudio = ALLOWED_AUDIO_TYPES.includes(fileType);
    const isDocument = ALLOWED_DOCUMENT_TYPES.includes(fileType);

    if (!isImage && !isVideo && !isAudio && !isDocument) {
      return { valid: false, error: "File type not supported" };
    }

    return { valid: true };
  }

  static async createPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      } else if (file.type.startsWith("video/")) {
        // Create video thumbnail
        const video = document.createElement("video");
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        
        video.addEventListener("loadeddata", () => {
          video.currentTime = 1; // Capture at 1 second
        });
        
        video.addEventListener("seeked", () => {
          if (context) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg"));
          }
        });
        
        video.src = URL.createObjectURL(file);
      } else {
        // For audio and documents, use placeholder
        resolve("");
      }
    });
  }

  static async extractMetadata(file: File): Promise<MediaFile["metadata"]> {
    const metadata: MediaFile["metadata"] = {
      size: file.size,
      mimeType: file.type,
    };

    if (file.type.startsWith("image/")) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          metadata.width = img.width;
          metadata.height = img.height;
          resolve(metadata);
        };
        img.onerror = () => resolve(metadata);
        img.src = URL.createObjectURL(file);
      });
    } else if (file.type.startsWith("video/")) {
      return new Promise((resolve) => {
        const video = document.createElement("video");
        video.addEventListener("loadedmetadata", () => {
          metadata.width = video.videoWidth;
          metadata.height = video.videoHeight;
          metadata.duration = video.duration;
          resolve(metadata);
        });
        video.onerror = () => resolve(metadata);
        video.src = URL.createObjectURL(file);
      });
    } else if (file.type.startsWith("audio/")) {
      return new Promise((resolve) => {
        const audio = new Audio();
        audio.addEventListener("loadedmetadata", () => {
          metadata.duration = audio.duration;
          resolve(metadata);
        });
        audio.onerror = () => resolve(metadata);
        audio.src = URL.createObjectURL(file);
      });
    }

    return metadata;
  }

  static async uploadMedia(
    conversationId: string,
    mediaFile: MediaFile
  ): Promise<ProcessedMedia> {
    if (!supabase) throw new Error("Supabase not configured");

    const fileExt = mediaFile.file.name.split(".").pop();
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const filePath = `chat-media/${conversationId}/${timestamp}-${randomId}.${fileExt}`;

    // Upload main file
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(filePath, mediaFile.file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(filePath);

    let thumbnailUrl: string | undefined;

    // Create and upload thumbnail for images and videos
    if (mediaFile.type === "image" || mediaFile.type === "video") {
      try {
        const thumbnailBlob = await this.createThumbnail(mediaFile.file);
        if (thumbnailBlob) {
          const thumbPath = `chat-media/${conversationId}/thumbnails/${timestamp}-${randomId}-thumb.jpg`;
          const { error: thumbError } = await supabase.storage
            .from("product-images")
            .upload(thumbPath, thumbnailBlob, {
              cacheControl: "3600",
              upsert: false,
            });

          if (!thumbError) {
            const { data: thumbUrlData } = supabase.storage
              .from("product-images")
              .getPublicUrl(thumbPath);
            thumbnailUrl = thumbUrlData.publicUrl;
          }
        }
      } catch (error) {
        console.warn("Failed to create thumbnail:", error);
      }
    }

    return {
      media_type: mediaFile.type,
      file_url: urlData.publicUrl,
      file_name: mediaFile.file.name,
      file_size: mediaFile.file.size,
      mime_type: mediaFile.file.type,
      thumbnail_url: thumbnailUrl,
      width: mediaFile.metadata?.width,
      height: mediaFile.metadata?.height,
      duration_seconds: mediaFile.metadata?.duration,
    };
  }

  static async createThumbnail(file: File): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (file.type.startsWith("image/")) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          
          // Calculate thumbnail dimensions (max 200px)
          const maxSize = 200;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
          } else {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
      } else if (file.type.startsWith("video/")) {
        const video = document.createElement("video");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        video.addEventListener("loadeddata", () => {
          video.currentTime = Math.min(1, video.duration / 2);
        });
        
        video.addEventListener("seeked", () => {
          if (ctx) {
            // Calculate thumbnail dimensions (max 200px)
            const maxSize = 200;
            let width = video.videoWidth;
            let height = video.videoHeight;
            
            if (width > height) {
              if (width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
              }
            } else {
              if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
              }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(video, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
          } else {
            resolve(null);
          }
        });
        
        video.onerror = () => resolve(null);
        video.src = URL.createObjectURL(file);
      } else {
        resolve(null);
      }
    });
  }

  static async processMultipleFiles(
    conversationId: string,
    files: File[]
  ): Promise<ProcessedMedia[]> {
    const processedFiles: ProcessedMedia[] = [];
    
    for (const file of files) {
      try {
        // Validate file
        const validation = await this.validateFile(file);
        if (!validation.valid) {
          console.warn(`Skipping invalid file ${file.name}: ${validation.error}`);
          continue;
        }

        // Determine media type
        let mediaType: MediaType = "document";
        if (file.type.startsWith("image/")) mediaType = "image";
        else if (file.type.startsWith("video/")) mediaType = "video";
        else if (file.type.startsWith("audio/")) mediaType = "audio";

        // Extract metadata
        const metadata = await this.extractMetadata(file);

        // Create media file object
        const mediaFile: MediaFile = {
          file,
          type: mediaType,
          metadata,
        };

        // Upload and process
        const processed = await this.uploadMedia(conversationId, mediaFile);
        processedFiles.push(processed);
      } catch (error) {
        console.error(`Failed to process file ${file.name}:`, error);
      }
    }
    
    return processedFiles;
  }

  // Emoji and sticker utilities
  static getEmojiCategories() {
    return {
      "Smileys & People": ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇"],
      "Animals & Nature": ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯"],
      "Food & Drink": ["🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈"],
      "Activities": ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸"],
      "Travel & Places": ["🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "✈️"],
      "Objects": ["💡", "🔦", "📱", "📲", "💻", "⌚", "📷", "🎥", "📺", "🔌"],
      "Symbols": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔"],
      "Flags": ["🏳️", "🏴", "🏁", "🚩", "🏳️‍🌈", "🏴‍☠️", "🇨🇩", "🇺🇸", "🇬🇧", "🇫🇷"],
    };
  }

  static getStickerPacks() {
    return {
      "DLX Default": [
        { id: "dlx-1", url: "/stickers/dlx/wave.png", name: "Wave" },
        { id: "dlx-2", url: "/stickers/dlx/thumbs-up.png", name: "Thumbs Up" },
        { id: "dlx-3", url: "/stickers/dlx/heart.png", name: "Heart" },
        { id: "dlx-4", url: "/stickers/dlx/party.png", name: "Party" },
        { id: "dlx-5", url: "/stickers/dlx/shopping.png", name: "Shopping" },
      ],
      "Reactions": [
        { id: "react-1", url: "/stickers/reactions/like.png", name: "Like" },
        { id: "react-2", url: "/stickers/reactions/love.png", name: "Love" },
        { id: "react-3", url: "/stickers/reactions/laugh.png", name: "Laugh" },
        { id: "react-4", url: "/stickers/reactions/wow.png", name: "Wow" },
        { id: "react-5", url: "/stickers/reactions/sad.png", name: "Sad" },
        { id: "react-6", url: "/stickers/reactions/angry.png", name: "Angry" },
      ],
    };
  }

  static async sendMessageWithMedia(
    conversationId: string,
    text: string,
    files: File[]
  ): Promise<any> {
    if (!supabase) throw new Error("Supabase not configured");

    // Process and upload files
    const processedMedia = await this.processMultipleFiles(conversationId, files);
    
    // Send message with media
    const { data, error } = await supabase.rpc("send_conversation_message_v2", {
      p_conversation_id: conversationId,
      p_body: text.trim(),
      p_media: JSON.stringify(processedMedia),
    });
    
    if (error) throw new Error(`Failed to send message: ${error.message}`);
    return data;
  }

  // Clean up temporary URLs
  static revokeObjectURL(url: string) {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }

  static formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  static getMediaIcon(type: MediaType): string {
    switch (type) {
      case "image": return "🖼️";
      case "video": return "🎥";
      case "audio": return "🎵";
      case "document": return "📄";
      case "sticker": return "🎨";
      default: return "📎";
    }
  }
}