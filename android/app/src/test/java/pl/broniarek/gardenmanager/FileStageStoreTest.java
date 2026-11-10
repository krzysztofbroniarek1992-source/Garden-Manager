package pl.broniarek.gardenmanager;

import org.junit.*;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class FileStageStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private FileStageStore store;
    @Before public void setup() throws Exception {store=new FileStageStore(temporary.newFolder());}
    @Test public void supportsBoundedCsvAndDeletesItsStage() throws Exception {
        byte[] csv="Data;Kwota;Opis\n10.11.2026;-12,30;Łódź".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String token=store.begin("wyciąg.csv","text/csv",csv.length);
        store.append(token,0,csv);
        FileStageStore.Stage stage=store.complete(token);
        assertEquals("text/csv",stage.mime);assertArrayEquals(csv,Files.readAllBytes(stage.file.toPath()));
        store.discard(token);assertFalse(stage.file.exists());
    }
    @Test public void csvCannotBypassItsOwnSizeLimit() {
        assertThrows(IOException.class,()->store.begin("large.csv","text/csv",5L*1024*1024+1));
    }
    @Test public void orderedBinaryRoundtrip() throws Exception {
        String token=store.begin("zażółć.pdf","application/pdf",5);
        store.append(token,0,new byte[]{0,1,2});store.append(token,3,new byte[]{-1,0});
        assertArrayEquals(new byte[]{0,1,2,-1,0},Files.readAllBytes(store.complete(token).file.toPath()));
    }
    @Test public void concurrentExportsHaveIndependentPaths() throws Exception {
        String a=store.begin("a.zip","application/zip",1), b=store.begin("a.zip","application/zip",1);
        assertNotEquals(a,b);store.append(a,0,new byte[]{1});store.append(b,0,new byte[]{2});
        assertNotEquals(store.complete(a).file,store.complete(b).file);
    }
    @Test public void rejectsReplayedChunk() throws Exception {
        String token=store.begin("a.json","application/json",2);store.append(token,0,new byte[]{1});
        assertThrows(IOException.class,()->store.append(token,0,new byte[]{2}));
    }
    @Test public void rejectsIncompleteExport() throws Exception {
        String token=store.begin("a.pdf","application/pdf",2);
        assertThrows(IOException.class,()->store.complete(token));
    }
    @Test public void enforcesDeclaredLength() throws Exception {
        String token=store.begin("a.pdf","application/pdf",1);
        assertThrows(IOException.class,()->store.append(token,0,new byte[]{1,2}));
    }
    @Test public void rejectsOversizedFile() {assertThrows(IOException.class,()->store.begin("a.zip","application/zip",FileStageStore.LIMIT+1));}
    @Test public void rejectsUnknownMime() {assertThrows(IOException.class,()->store.begin("a.html","text/html",2));}
    @Test public void rejectsUnknownToken() {assertThrows(IOException.class,()->store.complete("../../state"));}
    @Test public void sanitizesFilename() throws Exception {
        String token=store.begin("../../state/report.pdf","application/pdf",0);
        assertFalse(store.complete(token).file.getName().contains("/"));
    }
    @Test public void deletesOnlyItsOwnStage() throws Exception {
        String a=store.begin("a.zip","application/zip",0),b=store.begin("b.zip","application/zip",0);
        File file=store.complete(a).file;store.discard(a);
        assertFalse(file.exists());assertTrue(store.complete(b).file.exists());
    }
}
