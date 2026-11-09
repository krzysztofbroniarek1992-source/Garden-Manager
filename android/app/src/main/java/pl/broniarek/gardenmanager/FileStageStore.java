package pl.broniarek.gardenmanager;

import java.io.*;
import java.util.*;

/** Only disposable exports live here. No access to WebView/IndexedDB directories. */
final class FileStageStore {
    static final long LIMIT = 200L * 1024 * 1024;
    private final File root;
    private final Map<String, Stage> stages = new HashMap<>();
    static final class Stage {
        final File file;
        final String mime;
        final long size;
        Stage(File file, String mime, long size) { this.file=file; this.mime=mime; this.size=size; }
    }
    FileStageStore(File root) throws IOException {
        this.root=root;
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Brak miejsca na plik tymczasowy.");
        // URI grants for external viewers remain usable for 48 hours.
        File[] dirs=root.listFiles();
        if (dirs != null) for (File dir:dirs)
            if (dir.lastModified() < System.currentTimeMillis()-48L*60*60*1000) delete(dir);
    }
    synchronized String begin(String name, String mime, long size) throws IOException {
        if (size < 0 || size > LIMIT) throw new IOException("Limit pliku wynosi 200 MB.");
        if (!Arrays.asList("application/pdf","application/zip","application/json").contains(mime))
            throw new IOException("Nieobsługiwany typ pliku.");
        long used=0;
        File[] dirs=root.listFiles();
        if(dirs!=null) for(File dir:dirs) { File[] files=dir.listFiles(); if(files!=null) for(File f:files) used+=f.length(); }
        if (used+size > 600L*1024*1024) throw new IOException("Pamięć plików tymczasowych jest pełna. Spróbuj później.");
        String safe=name.replaceAll("[^\\p{L}\\p{N}._-]", "_");
        if(safe.length()>140) safe=safe.substring(safe.length()-140);
        if(safe.isEmpty() || safe.equals(".") || safe.equals("..")) safe="garden-manager";
        String token=UUID.randomUUID().toString();
        File dir=new File(root,token);
        if(!dir.mkdir()) throw new IOException("Nie udało się utworzyć pliku tymczasowego.");
        File file=new File(dir,safe);
        if(!file.createNewFile()) throw new IOException("Nie udało się utworzyć pliku.");
        stages.put(token,new Stage(file,mime,size));
        return token;
    }
    synchronized void append(String token, long offset, byte[] bytes) throws IOException {
        Stage stage=get(token);
        if(bytes.length>256*1024 || offset!=stage.file.length() || offset+bytes.length>stage.size)
            throw new IOException("Nieprawidłowa kolejność lub rozmiar fragmentu pliku.");
        try(FileOutputStream output=new FileOutputStream(stage.file,true)) { output.write(bytes); }
    }
    synchronized Stage get(String token) throws IOException {
        Stage stage=stages.get(token);
        if(stage==null) throw new IOException("Plik tymczasowy wygasł. Ponów operację.");
        return stage;
    }
    synchronized Stage complete(String token) throws IOException {
        Stage stage=get(token);
        if(stage.file.length()!=stage.size) throw new IOException("Zapis pliku jest niekompletny.");
        return stage;
    }
    synchronized void discard(String token) {
        Stage stage=stages.remove(token);
        if(stage!=null) delete(stage.file.getParentFile());
    }
    private static void delete(File file) {
        File[] children=file.listFiles();
        if(children!=null) for(File child:children) delete(child);
        file.delete();
    }
}
