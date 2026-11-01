# kotlinx.serialization: keep generated serializers of our DTOs.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-keep,includedescriptorclasses class com.sonora.app.data.net.**$$serializer { *; }
-keepclassmembers class com.sonora.app.data.net.** { *** Companion; }
-keepclasseswithmembers class com.sonora.app.data.net.** { kotlinx.serialization.KSerializer serializer(...); }
# Retrofit interfaces are used through reflection.
-keep,allowobfuscation interface com.sonora.app.data.net.SonoraApi
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-dontwarn org.slf4j.**
